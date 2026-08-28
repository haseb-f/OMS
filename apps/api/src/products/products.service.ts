import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, ProductStatus, ProductType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NumberingEngineService } from '../numbering/numbering-engine.service';
import {
  ProductActivityService,
  ProductActivityType,
} from './activities/product-activity.service';
import { ProductAttachmentsService } from './attachments/product-attachments.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { FindProductsQueryDto } from './dto/find-products-query.dto';
import { CreateProductAttachmentDto } from './dto/create-product-attachment.dto';
import { prismaEnumFilter } from '../common/query/enum-list';

/**
 * Product Business Behavior defaults (TASK-028) — each behavior has
 * sensible isPurchasable/isSellable/isInventoryItem defaults, always
 * overridable per product:
 * - PURCHASE_ONLY: enters inventory, never sold.
 * - SALES_ONLY: sold, not purchased through this system, still
 *   inventory-tracked (distinct from SERVICE, which has no physical form).
 * - PURCHASE_AND_SALE: normal inventory item.
 * - MANUFACTURED (renamed from KIT): sold as one item, built from
 *   component products — its BOM (ProductComponent rows) is what actually
 *   carries the component-level inventory; the manufactured item itself is
 *   still purchasable/stockable (e.g. produced in bulk, purchased pending
 *   production) and sellable.
 * - SERVICE: no inventory.
 * - EXPENSE_ITEM: future ready — bought and expensed, never stocked or sold.
 */
const DEFAULT_FLAGS_BY_TYPE: Record<
  ProductType,
  { isPurchasable: boolean; isSellable: boolean; isInventoryItem: boolean }
> = {
  PURCHASE_ONLY: {
    isPurchasable: true,
    isSellable: false,
    isInventoryItem: true,
  },
  SALES_ONLY: {
    isPurchasable: false,
    isSellable: true,
    isInventoryItem: true,
  },
  PURCHASE_AND_SALE: {
    isPurchasable: true,
    isSellable: true,
    isInventoryItem: true,
  },
  MANUFACTURED: {
    isPurchasable: true,
    isSellable: true,
    isInventoryItem: true,
  },
  SERVICE: { isPurchasable: false, isSellable: true, isInventoryItem: false },
  EXPENSE_ITEM: {
    isPurchasable: true,
    isSellable: false,
    isInventoryItem: false,
  },
};

const DOCUMENT_TYPE = 'PRODUCT';

@Injectable()
export class ProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activityService: ProductActivityService,
    private readonly attachmentsService: ProductAttachmentsService,
    private readonly numberingEngine: NumberingEngineService,
  ) {}

  /**
   * TASK-028: the create screen only asks for name/type/category/unit/
   * prices/tax/analytic account — no weight/dimensions, no Internal Name,
   * no Display Name. Dimensions are never required here (deferred entirely
   * to post-save editing, superseding ADR-0012's "mandatory when
   * isInventoryItem" rule for the creation flow specifically);
   * internalName/displayName default to the Arabic `name` when omitted,
   * remaining editable later for a business that wants them to diverge.
   *
   * Defaults to DRAFT (not ACTIVE) when `status` is omitted — this is the
   * Draft-first principle: a product created with only the lean create
   * screen's fields isn't yet operationally complete (no price, no
   * dimensions), so it shouldn't silently look ACTIVE. Explicitly
   * requesting ACTIVE at creation still goes through the same activation
   * check as `update()`.
   */
  async create(dto: CreateProductDto, userId?: string) {
    // Product Creation Wizard — Product Type is never an extra required
    // step; PURCHASE_AND_SALE is the safest default (sellable AND
    // purchasable) when the wizard's caller omits it entirely.
    const type = dto.type ?? ProductType.PURCHASE_AND_SALE;
    const defaults = DEFAULT_FLAGS_BY_TYPE[type];
    const isPurchasable = dto.isPurchasable ?? defaults.isPurchasable;
    const isSellable = dto.isSellable ?? defaults.isSellable;
    const isInventoryItem = dto.isInventoryItem ?? defaults.isInventoryItem;
    const status = dto.status ?? ProductStatus.DRAFT;

    if (status === ProductStatus.ACTIVE) {
      this.assertActivationReady({
        name: dto.name,
        categoryId: dto.categoryId,
        unitId: dto.unitId,
      });
    }

    // Minted before the transaction — same trade-off as every other
    // caller of the Numbering Engine (Suppliers/Leads/SalesOrders/...):
    // a rollback leaves a gap in the sequence, which is fine.
    const sku = await this.numberingEngine.generateNumber(DOCUMENT_TYPE);

    try {
      return await this.prisma.$transaction(async (tx) => {
        const product = await tx.product.create({
          data: {
            ...dto,
            type,
            status,
            sku,
            internalName: dto.internalName || dto.name,
            displayName: dto.displayName || dto.name,
            isPurchasable,
            isSellable,
            isInventoryItem,
            createdBy: userId ?? null,
            updatedBy: userId ?? null,
          },
        });
        await this.activityService.log(
          product.id,
          ProductActivityType.PRODUCT_CREATED,
          `Product ${product.sku} created`,
          undefined,
          tx,
        );
        return product;
      });
    } catch (error) {
      throw this.mapError(error);
    }
  }

  /**
   * Real server-side pagination (TASK-027) — Products is the first "rich
   * entity" module in this codebase to get one; Suppliers/Leads still
   * return everything unpaginated. Filtering by Category/Brand/Tax/Status/
   * Type; search by SKU/Name/NameEn/Barcode/InternalName/DisplayName/
   * SearchKeywords.
   */
  async findAll(query: FindProductsQueryDto) {
    const where: Prisma.ProductWhereInput = {
      deletedAt: query.includeArchived ? undefined : null,
      categoryId: prismaEnumFilter(query.categoryId),
      brandId: prismaEnumFilter(query.brandId),
      taxId: query.taxId,
      status: prismaEnumFilter(query.status),
      type: prismaEnumFilter(query.type),
      isInventoryItem: query.isInventoryItem,
    };

    if (query.search) {
      where.OR = [
        { sku: { contains: query.search, mode: 'insensitive' } },
        { name: { contains: query.search, mode: 'insensitive' } },
        { nameEn: { contains: query.search, mode: 'insensitive' } },
        { barcode: { contains: query.search, mode: 'insensitive' } },
        { internalName: { contains: query.search, mode: 'insensitive' } },
        { displayName: { contains: query.search, mode: 'insensitive' } },
        { searchKeywords: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const sortBy = query.sortBy ?? 'createdAt';
    const sortOrder = query.sortOrder ?? 'asc';

    const [items, total] = await this.prisma.$transaction([
      this.prisma.product.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { [sortBy]: sortOrder },
        // List/preview UI only ever reads category.name and brand.name —
        // unit/tax/preferredWarehouse were fetched in full on every row of
        // every page without being used anywhere on the list screen.
        include: {
          category: { select: { id: true, name: true } },
          brand: { select: { id: true, name: true } },
        },
      }),
      this.prisma.product.count({ where }),
    ]);

    return { items, total, page, pageSize };
  }

  async findOne(id: string) {
    const product = await this.prisma.product.findFirst({
      where: { id, deletedAt: null },
      include: {
        category: true,
        brand: true,
        unit: true,
        tax: true,
        analyticAccount: true,
        preferredSupplier: true,
        preferredWarehouse: true,
      },
    });
    if (!product) {
      throw new NotFoundException(`Product ${id} not found`);
    }
    return product;
  }

  /**
   * Batched lookup for per-line "is this product active" validation loops
   * (Sales/Purchase Orders, Invoices, Quotations, Returns) — one query for
   * every line on a document instead of one query per line. Callers pair
   * this with `assertActiveProduct` from `assert-active-product.util.ts`.
   */
  async findManyForValidation(productIds: string[]) {
    const uniqueIds = [...new Set(productIds)];
    if (uniqueIds.length === 0) {
      return new Map<string, { id: string; status: ProductStatus }>();
    }
    const products = await this.prisma.product.findMany({
      where: { id: { in: uniqueIds }, deletedAt: null },
      select: { id: true, status: true },
    });
    return new Map(products.map((p) => [p.id, p]));
  }

  async update(id: string, dto: UpdateProductDto, userId?: string) {
    const existing = await this.findOne(id);

    const nextStatus = dto.status ?? existing.status;
    if (
      nextStatus === ProductStatus.ACTIVE &&
      existing.status !== ProductStatus.ACTIVE
    ) {
      this.assertActivationReady({
        name: dto.name ?? existing.name,
        categoryId: dto.categoryId ?? existing.categoryId,
        unitId: dto.unitId ?? existing.unitId,
      });
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        const product = await tx.product.update({
          where: { id },
          data: { ...dto, updatedBy: userId ?? null },
        });
        await this.activityService.log(
          id,
          ProductActivityType.PRODUCT_UPDATED,
          `Product ${product.sku} updated`,
          undefined,
          tx,
        );
        return product;
      });
    } catch (error) {
      throw this.mapError(error);
    }
  }

  /** Soft delete only. */
  async archive(id: string, userId?: string) {
    const existing = await this.findOne(id);
    return this.prisma.$transaction(async (tx) => {
      const product = await tx.product.update({
        where: { id },
        data: { deletedAt: new Date(), updatedBy: userId ?? null },
      });
      await this.activityService.log(
        id,
        ProductActivityType.PRODUCT_ARCHIVED,
        `Product ${existing.sku} archived`,
        undefined,
        tx,
      );
      return product;
    });
  }

  async restore(id: string, userId?: string) {
    const product = await this.prisma.product.findFirst({
      where: { id, NOT: { deletedAt: null } },
    });
    if (!product) {
      throw new NotFoundException(`Archived product ${id} not found`);
    }
    return this.prisma.$transaction(async (tx) => {
      const restored = await tx.product.update({
        where: { id },
        data: { deletedAt: null, updatedBy: userId ?? null },
      });
      await this.activityService.log(
        id,
        ProductActivityType.PRODUCT_RESTORED,
        `Product ${restored.sku} restored`,
        undefined,
        tx,
      );
      return restored;
    });
  }

  async attach(id: string, dto: CreateProductAttachmentDto, userId: string) {
    await this.findOne(id);
    return this.prisma.$transaction(async (tx) => {
      const attachment = await this.attachmentsService.create(
        id,
        userId,
        dto,
        tx,
      );
      await this.activityService.log(
        id,
        ProductActivityType.ATTACHMENT_ADDED,
        'Attachment added',
        { attachmentId: attachment.id, fileName: dto.fileName },
        tx,
      );
      return attachment;
    });
  }

  /**
   * The Draft → Active gate (Product Creation Wizard) — exactly Name,
   * Category, and Unit of Measure, the same three fields required to
   * create a product at all. Every other field (price, tax, supplier,
   * inventory settings, dimensions, ...) stays fully optional at
   * activation — a draft with nothing but the three required fields must
   * be activatable. These three are already non-nullable DB columns (so a
   * real, previously-saved row can never actually fail this), but the
   * check stays explicit here as the one place activation's business rule
   * is stated and server-side enforced, independent of whatever the
   * frontend does.
   */
  private assertActivationReady(data: {
    name?: string | null;
    categoryId?: string | null;
    unitId?: string | null;
  }): void {
    const missing: string[] = [];
    if (!data.name?.trim()) missing.push('name');
    if (!data.categoryId) missing.push('categoryId');
    if (!data.unitId) missing.push('unitId');
    if (missing.length > 0) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Product is missing fields required for activation.',
        fields: missing.map((field) => ({
          field,
          constraints: ['required_for_activation'],
        })),
      });
    }
  }

  /**
   * Dedicated Draft → Active business operation (mirrors Purchase Order's
   * `approve()` transition pattern) — a named endpoint the "تفعيل المنتج"
   * button calls, rather than relying on callers to know that `PATCH
   * {status: 'ACTIVE'}` happens to do the same thing. Only ever moves a
   * DRAFT or INACTIVE product to ACTIVE; already-ACTIVE is a no-op success
   * (idempotent — clicking twice, or a slow double-submit, never errors).
   */
  async activate(id: string, userId?: string) {
    const existing = await this.findOne(id);
    if (existing.status === ProductStatus.ACTIVE) {
      return existing;
    }
    this.assertActivationReady({
      name: existing.name,
      categoryId: existing.categoryId,
      unitId: existing.unitId,
    });
    return this.prisma.$transaction(async (tx) => {
      const product = await tx.product.update({
        where: { id },
        data: { status: ProductStatus.ACTIVE, updatedBy: userId ?? null },
        include: {
          category: true,
          brand: true,
          unit: true,
          tax: true,
          analyticAccount: true,
          preferredSupplier: true,
          preferredWarehouse: true,
        },
      });
      await this.activityService.log(
        id,
        ProductActivityType.PRODUCT_ACTIVATED,
        `Product ${product.sku} activated`,
        undefined,
        tx,
      );
      return product;
    });
  }

  private mapError(error: unknown): Error {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2002') {
        return new BadRequestException('SKU must be unique.');
      }
      if (error.code === 'P2003') {
        return new BadRequestException(
          'Invalid category, brand, unit, tax, analytic account, warehouse, or supplier reference.',
        );
      }
    }
    return error as Error;
  }
}
