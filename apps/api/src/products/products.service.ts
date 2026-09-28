import {
  Injectable,
  BadRequestException,
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
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
import { findArabicNormalizedIds } from '../common/text/arabic-search.query';

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

/** Agents milestone — owner agent summary on product detail/list rows. */
const OWNER_AGENT_SELECT = {
  select: { id: true, name: true, agentNumber: true },
} as const;

/** Arabic-bearing product columns for the shared Arabic-normalized search (`common/text/arabic-search.ts`). */
export const PRODUCT_NORMALIZED_SEARCH = {
  table: 'products',
  columns: ['name', 'internal_name', 'display_name', 'search_keywords'],
} as const;

/** Every real Product column — the management list's `sortBy` allowlist. */
const PRODUCT_SCALAR_FIELDS: ReadonlySet<string> = new Set(
  Object.values(Prisma.ProductScalarFieldEnum),
);

/** `GET /products/catalog` `sortBy` allowlist — identity columns only. */
export const PRODUCT_CATALOG_SORTABLE_FIELDS: readonly string[] = [
  'displayName',
  'name',
  'nameEn',
  'internalName',
  'sku',
  'createdAt',
];

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
    if (dto.ownerAgentId)
      await this.assertOwnerAgentAssignable(dto.ownerAgentId);

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
   * Shared by the management list and the picker catalog: plain
   * case-insensitive `contains` on SKU/Name/NameEn/Barcode/InternalName/
   * DisplayName/SearchKeywords, plus (for Arabic text) the shared
   * Arabic-normalized match on the Arabic-bearing columns, so "أحمد" finds
   * "احمد" and "مصطفى" finds "مصطفي".
   */
  private async buildSearchOr(
    search: string,
  ): Promise<Prisma.ProductWhereInput[]> {
    const or: Prisma.ProductWhereInput[] = [
      { sku: { contains: search, mode: 'insensitive' } },
      { name: { contains: search, mode: 'insensitive' } },
      { nameEn: { contains: search, mode: 'insensitive' } },
      { barcode: { contains: search, mode: 'insensitive' } },
      { internalName: { contains: search, mode: 'insensitive' } },
      { displayName: { contains: search, mode: 'insensitive' } },
      { searchKeywords: { contains: search, mode: 'insensitive' } },
    ];
    const normalizedIds = await findArabicNormalizedIds(
      this.prisma,
      PRODUCT_NORMALIZED_SEARCH,
      search,
    );
    if (normalizedIds?.length) or.push({ id: { in: normalizedIds } });
    return or;
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
      isSellable: query.isSellable,
      isPurchasable: query.isPurchasable,
      ownerAgentId: query.agentId
        ? query.agentId
        : query.ownership === 'COMPANY'
          ? null
          : query.ownership === 'AGENT'
            ? { not: null }
            : undefined,
    };

    if (query.search) where.OR = await this.buildSearchOr(query.search);

    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    // SEC-03 L2 — only real scalar columns; anything else falls back to the
    // default instead of reaching Prisma as an unknown field (a 500).
    const sortBy =
      query.sortBy && PRODUCT_SCALAR_FIELDS.has(query.sortBy)
        ? query.sortBy
        : 'createdAt';
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
          ownerAgent: OWNER_AGENT_SELECT,
        },
      }),
      this.prisma.product.count({ where }),
    ]);

    return { items, total, page, pageSize };
  }

  /**
   * Catalog browse for a picker (Lead conversion, Store Order create,
   * Purchase Order create, Inventory movements) — never Product management.
   * Unlike `findAll()`, `status`/`deletedAt` are forced server-side (never
   * trusted from the query string), and the select is deliberately narrow:
   * no purchase price, cost, supplier, or reorder data reaches a caller who
   * only holds an order-creation permission, not `products.view`.
   */
  async findSellableCatalog(query: FindProductsQueryDto) {
    const where: Prisma.ProductWhereInput = {
      deletedAt: null,
      status: ProductStatus.ACTIVE,
      id: query.ids?.length ? { in: query.ids } : undefined,
      categoryId: prismaEnumFilter(query.categoryId),
      brandId: prismaEnumFilter(query.brandId),
      type: prismaEnumFilter(query.type),
      isInventoryItem: query.isInventoryItem,
      isSellable: query.isSellable,
      isPurchasable: query.isPurchasable,
      // Investment Opportunity selector: together with ACTIVE + not deleted
      // above, this is exactly `isInvestmentEligible` (investment-opportunities/shared).
      availableForInvestmentOpportunities: query.investmentEligible,
      // Agents milestone (spec §4): company flows never offer agent-owned
      // goods; an agent's products are listed only for an explicit agentId
      // (the controller honors it only for `agents.view` holders; the agent
      // portal passes its server-derived agent).
      ownerAgentId: query.agentId ?? null,
    };

    if (query.search) where.OR = await this.buildSearchOr(query.search);

    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    // SEC-03 L2 — picker ordering is limited to identity columns the
    // catalog already returns (never cost/purchase-price ordering).
    const sortBy =
      query.sortBy && PRODUCT_CATALOG_SORTABLE_FIELDS.includes(query.sortBy)
        ? query.sortBy
        : 'displayName';
    const sortOrder = query.sortOrder ?? 'asc';

    const [items, total] = await this.prisma.$transaction([
      this.prisma.product.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { [sortBy]: sortOrder },
        select: {
          id: true,
          name: true,
          nameEn: true,
          internalName: true,
          displayName: true,
          sku: true,
          barcode: true,
          status: true,
          type: true,
          isSellable: true,
          isPurchasable: true,
          isInventoryItem: true,
          availableForInvestmentOpportunities: true,
          salesPrice: true,
          category: { select: { id: true, name: true } },
          brand: { select: { id: true, name: true } },
          unitId: true,
          unit: { select: { id: true, name: true } },
          // Document lines default their tax from the product.
          taxId: true,
          ownerAgentId: true,
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
        preferredPartner: true,
        preferredWarehouse: true,
        ownerAgent: OWNER_AGENT_SELECT,
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
      return new Map<
        string,
        { id: string; status: ProductStatus; ownerAgentId: string | null }
      >();
    }
    const products = await this.prisma.product.findMany({
      where: { id: { in: uniqueIds }, deletedAt: null },
      select: { id: true, status: true, ownerAgentId: true },
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

    const ownerChanging =
      dto.ownerAgentId !== undefined &&
      (dto.ownerAgentId ?? null) !== existing.ownerAgentId;
    if (ownerChanging && dto.ownerAgentId) {
      await this.assertOwnerAgentAssignable(dto.ownerAgentId);
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        if (ownerChanging) await this.assertOwnerUnlocked(tx, id);
        const product = await tx.product.update({
          where: { id },
          data: { ...dto, updatedBy: userId ?? null },
        });
        await this.activityService.log(
          id,
          ProductActivityType.PRODUCT_UPDATED,
          ownerChanging
            ? `Product ${product.sku} updated — owner agent ${existing.ownerAgentId ?? 'company'} → ${product.ownerAgentId ?? 'company'}`
            : `Product ${product.sku} updated`,
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
          preferredPartner: true,
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

  /** Owner agent must exist, not be archived and be ACTIVE (spec §4). */
  private async assertOwnerAgentAssignable(agentId: string) {
    const agent = await this.prisma.agent.findFirst({
      where: { id: agentId, deletedAt: null },
      select: { status: true },
    });
    if (!agent || agent.status !== 'ACTIVE') {
      throw new UnprocessableEntityException({
        code: 'AGENT_NOT_ACTIVE',
        message:
          'الوكيل غير موجود أو غير نشط — The owner agent does not exist or is not active.',
      });
    }
  }

  /**
   * Ownership is history: once the product has any stock movement or order
   * line it can no longer change owner (spec §4). Locks the product row so
   * a concurrent first movement cannot slip in between check and update.
   */
  private async assertOwnerUnlocked(
    tx: Prisma.TransactionClient,
    productId: string,
  ) {
    await tx.$queryRaw`SELECT id FROM products WHERE id = ${productId}::uuid FOR UPDATE`;
    // Sequential: queries share the interactive transaction's connection.
    // Any document, lead or order line referencing the product locks its
    // owner (S2) — company documents were validated against the old owner.
    const where = { productId };
    const counts = [
      await tx.inventoryMovement.count({ where }),
      await tx.storeOrderItem.count({ where }),
      await tx.lead.count({ where }),
      await tx.orderItem.count({ where }),
      await tx.salesQuotationItem.count({ where }),
      await tx.salesOrderDocumentItem.count({ where }),
      await tx.salesInvoiceItem.count({ where }),
      await tx.salesReturnItem.count({ where }),
      await tx.purchaseOrderItem.count({ where }),
      await tx.purchaseQuotationItem.count({ where }),
      await tx.purchaseInvoiceItem.count({ where }),
      await tx.purchaseReturnItem.count({ where }),
      await tx.opportunityProduct.count({ where }),
    ];
    if (counts.some((count) => count > 0)) {
      throw new ConflictException({
        code: 'PRODUCT_OWNER_LOCKED',
        message:
          'لا يمكن تغيير مالك المنتج بعد وجود حركات مخزون أو بنود طلبات عليه — The product owner cannot change once the product has stock movements, leads, order or document lines.',
      });
    }
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
