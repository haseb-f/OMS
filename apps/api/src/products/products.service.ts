import {
  Injectable,
  BadRequestException,
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  InventoryMovementType,
  ItemType,
  Prisma,
  ProductStatus,
  ProductSupplyMethod,
  ProductType,
} from '@prisma/client';
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
import {
  investmentBlockedReason,
  investmentNotAllowedBody,
  type InvestmentStructuralCandidate,
} from '../investment-opportunities/shared/investment-eligibility.util';
import {
  deriveLegacyProductType,
  findProductRuleViolation,
  resolveProductAttributes,
  type ProductAttributes,
} from './product-attributes';

const DOCUMENT_TYPE = 'PRODUCT';

/** The reserved ledger (RESERVATION / RESERVATION_RELEASE) — never part of on-hand (ADR-0013). */
const RESERVATION_TYPES: InventoryMovementType[] = [
  InventoryMovementType.RESERVATION,
  InventoryMovementType.RESERVATION_RELEASE,
];

/** Stored barcodes are trimmed and an empty one is null — what the DB's partial unique index (lower(btrim(barcode))) compares. */
const normalizeBarcode = (barcode: string | null | undefined) =>
  barcode?.trim() || null;

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
   * TASK-028: the create screen only asks for name/category/unit/prices/tax/
   * analytic account — no weight/dimensions, no Internal Name, no Display Name.
   * Dimensions are never required here (deferred entirely to post-save
   * editing, superseding ADR-0012's "mandatory when isInventoryItem" rule for
   * the creation flow specifically); internalName/displayName default to the
   * Arabic `name` when omitted, remaining editable later for a business that
   * wants them to diverge.
   *
   * R13 — the attributes are independent: itemType / sell / buy / track stock
   * / supply method default from the item type (explicit values win), the hard
   * rules between them are enforced here, and the stored legacy `type` is
   * derived — never trusted from the client (a lone legacy `type` is only a
   * hint mapped onto the attributes). Unit and tax fall back to the category's
   * defaults when omitted.
   *
   * Defaults to DRAFT (not ACTIVE) when `status` is omitted — this is the
   * Draft-first principle: a product created with only the lean create
   * screen's fields isn't yet operationally complete (no price, no
   * dimensions), so it shouldn't silently look ACTIVE. Explicitly
   * requesting ACTIVE at creation still goes through the same activation
   * check as `update()`.
   */
  async create(dto: CreateProductDto, userId?: string) {
    const attributes = resolveProductAttributes(dto);
    this.assertAttributeRules(attributes);
    const type = deriveLegacyProductType(
      attributes.itemType,
      attributes,
      attributes.supplyMethod,
    );
    const status = dto.status ?? ProductStatus.DRAFT;

    const category = await this.prisma.productCategory.findUnique({
      where: { id: dto.categoryId },
      select: { defaultUnitId: true, defaultTaxId: true },
    });
    const unitId = dto.unitId ?? category?.defaultUnitId;
    if (!unitId) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message:
          'Unit is required — choose one, or set a default unit on the category.',
        fields: [{ field: 'unitId', constraints: ['required'] }],
      });
    }
    // An explicit null means "no tax" (tax is optional); only an omitted value inherits.
    const taxId =
      dto.taxId !== undefined ? dto.taxId : (category?.defaultTaxId ?? null);

    if (status === ProductStatus.ACTIVE) {
      this.assertActivationReady({
        name: dto.name,
        categoryId: dto.categoryId,
        unitId,
      });
    }
    if (dto.availableForInvestmentOpportunities) {
      this.assertInvestmentAllowed(
        {
          status,
          deletedAt: null,
          ownerAgentId: dto.ownerAgentId ?? null,
          itemType: attributes.itemType,
          type,
          isSellable: attributes.isSellable,
        },
        dto.displayName || dto.name,
      );
    }

    const barcode = normalizeBarcode(dto.barcode);
    if (barcode) await this.assertBarcodeAvailable(barcode);

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
            ...attributes,
            type,
            status,
            sku,
            unitId,
            taxId,
            barcode,
            internalName: dto.internalName || dto.name,
            displayName: dto.displayName || dto.name,
            createdBy: userId ?? null,
            updatedBy: userId ?? null,
          },
          include: { ownerAgent: OWNER_AGENT_SELECT },
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
      throw await this.mapWriteError(error, barcode);
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
      itemType:
        query.itemType === 'UNSET' ? null : (query.itemType ?? undefined),
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

    if (query.investmentEligible) {
      // R13 — the structural half of the eligibility rule (see
      // `investmentBlockedReason`): company-owned, sellable, non-service goods only.
      where.ownerAgentId = null;
      where.AND = [
        { isSellable: true },
        { type: { not: ProductType.SERVICE } },
      ];
    }

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
          itemType: true,
          supplyMethod: true,
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

  /**
   * R13 — when any attribute (item type, sell / buy / track stock, supply
   * method, or a legacy `type` that actually changes) is touched, the whole
   * set is re-resolved against the stored one, re-validated against the hard
   * rules, and the legacy `type` re-derived. A change of item type applies the
   * new type's defaults to what the caller did not state. Untouched attributes
   * are never re-checked, so unrelated edits of older products never fail on
   * historical data.
   */
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

    const current: ProductAttributes = {
      itemType:
        existing.itemType ??
        (existing.type === ProductType.SERVICE
          ? ItemType.SERVICE
          : ItemType.PRODUCT),
      isSellable: existing.isSellable,
      isPurchasable: existing.isPurchasable,
      isInventoryItem: existing.isInventoryItem,
      supplyMethod: existing.supplyMethod,
    };
    // A legacy `type` echoed back unchanged (an old form re-sending the row) is no hint.
    const typeHint =
      dto.type !== undefined && dto.type !== existing.type
        ? dto.type
        : undefined;
    const attributesTouched =
      typeHint !== undefined ||
      [
        dto.itemType,
        dto.isSellable,
        dto.isPurchasable,
        dto.isInventoryItem,
        dto.supplyMethod,
      ].some((value) => value !== undefined);
    let attributeData: (ProductAttributes & { type: ProductType }) | undefined;
    if (attributesTouched) {
      const next = resolveProductAttributes(
        {
          type: typeHint,
          itemType: dto.itemType,
          isSellable: dto.isSellable,
          isPurchasable: dto.isPurchasable,
          isInventoryItem: dto.isInventoryItem,
          supplyMethod: dto.supplyMethod,
        },
        current,
      );
      this.assertAttributeRules(next);
      attributeData = {
        ...next,
        type: deriveLegacyProductType(next.itemType, next, next.supplyMethod),
      };
    }
    const supplyMethodLocking =
      attributeData !== undefined &&
      attributeData.supplyMethod !== existing.supplyMethod &&
      (attributeData.supplyMethod === ProductSupplyMethod.KIT ||
        existing.supplyMethod === ProductSupplyMethod.KIT);

    const ownerChanging =
      dto.ownerAgentId !== undefined &&
      (dto.ownerAgentId ?? null) !== existing.ownerAgentId;
    if (ownerChanging && dto.ownerAgentId) {
      await this.assertOwnerAgentAssignable(dto.ownerAgentId);
    }

    // Only NEW flag-enabling is checked; a grandfathered product stays as is,
    // and turning the flag off is always allowed.
    if (
      dto.availableForInvestmentOpportunities === true &&
      !existing.availableForInvestmentOpportunities
    ) {
      this.assertInvestmentAllowed(
        {
          status: nextStatus,
          deletedAt: existing.deletedAt,
          ownerAgentId:
            dto.ownerAgentId !== undefined
              ? (dto.ownerAgentId ?? null)
              : existing.ownerAgentId,
          itemType: attributeData?.itemType ?? current.itemType,
          type: attributeData?.type ?? existing.type,
          isSellable: attributeData?.isSellable ?? existing.isSellable,
        },
        dto.displayName ?? existing.displayName,
      );
    }

    const barcode = normalizeBarcode(dto.barcode);
    if (
      dto.barcode !== undefined &&
      barcode &&
      barcode !== normalizeBarcode(existing.barcode)
    ) {
      await this.assertBarcodeAvailable(barcode, id);
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        if (ownerChanging) await this.assertOwnerUnlocked(tx, id);
        if (supplyMethodLocking) await this.assertSupplyMethodUnlocked(tx, id);
        const product = await tx.product.update({
          where: { id },
          data: {
            ...dto,
            ...attributeData,
            ...(dto.barcode !== undefined ? { barcode } : {}),
            updatedBy: userId ?? null,
          },
          include: { ownerAgent: OWNER_AGENT_SELECT },
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
      throw await this.mapWriteError(error, barcode, id);
    }
  }

  /**
   * Spec 2 (R5) — moves ownership from `expectedOwnerAgentId` to
   * `nextOwnerAgentId` (null = company) atomically: under the product row
   * lock the current owner is re-read, so of two concurrent links only the
   * first wins (PRODUCT_OWNER_CHANGED for the other). Same validation and
   * ownership lock as `update()` (active agent, PRODUCT_OWNER_LOCKED).
   */
  async changeOwner(
    id: string,
    expectedOwnerAgentId: string | null,
    nextOwnerAgentId: string | null,
    userId?: string,
  ) {
    if (nextOwnerAgentId)
      await this.assertOwnerAgentAssignable(nextOwnerAgentId);
    return this.prisma.$transaction(async (tx) => {
      // Locks the product row, then refuses once referenced.
      await this.assertOwnerUnlocked(tx, id);
      const current = await tx.product.findFirst({
        where: { id, deletedAt: null },
        select: { ownerAgentId: true, sku: true },
      });
      if (!current) throw new NotFoundException(`Product ${id} not found`);
      if (current.ownerAgentId !== expectedOwnerAgentId) {
        throw new ConflictException({
          code: 'PRODUCT_OWNER_CHANGED',
          message:
            'تغيّر مالك المنتج للتو — أعد التحميل وحاول مجددًا — The product owner just changed; reload and try again.',
        });
      }
      const product = await tx.product.update({
        where: { id },
        data: { ownerAgentId: nextOwnerAgentId, updatedBy: userId ?? null },
      });
      await this.activityService.log(
        id,
        ProductActivityType.PRODUCT_UPDATED,
        `Product ${current.sku} updated — owner agent ${expectedOwnerAgentId ?? 'company'} → ${nextOwnerAgentId ?? 'company'}`,
        undefined,
        tx,
      );
      return product;
    });
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
    // The barcode may have been taken by another product while this one was archived.
    const barcode = normalizeBarcode(product.barcode);
    if (barcode) await this.assertBarcodeAvailable(barcode, id);
    try {
      return await this.prisma.$transaction(async (tx) => {
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
    } catch (error) {
      throw await this.mapWriteError(error, barcode, id);
    }
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
          ownerAgent: OWNER_AGENT_SELECT,
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
      // R13 — a recipe fixes one owner across the finished product and every
      // component, so being either side of a recipe locks the owner too.
      await tx.productRecipe.count({ where }),
      await tx.productRecipeLine.count({
        where: { componentProductId: productId },
      }),
    ];
    if (counts.some((count) => count > 0)) {
      throw new ConflictException({
        code: 'PRODUCT_OWNER_LOCKED',
        message:
          'لا يمكن تغيير مالك المنتج بعد وجود حركات مخزون أو بنود طلبات أو وصفات تركيب عليه — The product owner cannot change once the product has stock movements, leads, order or document lines, or recipes.',
      });
    }
  }

  /**
   * KIT is a different stock model (no balance of its own): switching to or
   * from it is refused while the product still has on-hand stock or reserved
   * quantity, computed from the movement ledger under the product row lock.
   */
  private async assertSupplyMethodUnlocked(
    tx: Prisma.TransactionClient,
    productId: string,
  ) {
    await tx.$queryRaw`SELECT id FROM products WHERE id = ${productId}::uuid FOR UPDATE`;
    const onHand = await tx.inventoryMovement.aggregate({
      where: { productId, type: { notIn: RESERVATION_TYPES } },
      _sum: { quantity: true },
    });
    const reserved = await tx.inventoryMovement.aggregate({
      where: { productId, type: { in: RESERVATION_TYPES } },
      _sum: { quantity: true },
    });
    if (
      (onHand._sum.quantity ?? 0) !== 0 ||
      (reserved._sum.quantity ?? 0) !== 0
    ) {
      throw new ConflictException({
        code: 'PRODUCT_SUPPLY_METHOD_LOCKED',
        message:
          'لا يمكن التحويل من أو إلى «مجموعة» (Kit) ما دام للمنتج رصيد أو حجوزات — The supply method cannot change to or from Kit while the product has stock on hand or reservations.',
      });
    }
  }

  /** The hard rules between the independent attributes (422 with the rule's code). */
  private assertAttributeRules(attributes: ProductAttributes): void {
    const violation = findProductRuleViolation(attributes);
    if (violation) throw new UnprocessableEntityException(violation);
  }

  /** Investor eligibility, API-enforced (not only the picker): 422 PRODUCT_INVESTMENT_NOT_ALLOWED with the reason. */
  private assertInvestmentAllowed(
    candidate: InvestmentStructuralCandidate,
    displayName: string,
  ): void {
    const reason = investmentBlockedReason(candidate);
    if (reason) {
      throw new UnprocessableEntityException(
        investmentNotAllowedBody(reason, displayName),
      );
    }
  }

  /**
   * Barcodes are unique among non-archived products, ignoring case and
   * surrounding spaces — 409 naming the product that already holds it. Also
   * used by Import's dry-run so a duplicate row shows in the preview.
   */
  async assertBarcodeAvailable(barcode: string, excludeId?: string) {
    const owner = await this.findBarcodeOwner(barcode, excludeId);
    if (owner) throw this.barcodeDuplicate(owner);
  }

  private async findBarcodeOwner(barcode: string, excludeId?: string) {
    const rows = await this.prisma.$queryRaw<
      { id: string; sku: string; name: string }[]
    >(
      Prisma.sql`SELECT id::text AS id, sku, name FROM products
        WHERE deleted_at IS NULL AND barcode IS NOT NULL
          AND lower(btrim(barcode)) = lower(btrim(${barcode}))
          ${excludeId ? Prisma.sql`AND id <> ${excludeId}::uuid` : Prisma.empty}
        LIMIT 1`,
    );
    return rows[0] ?? null;
  }

  private barcodeDuplicate(owner: { id: string; sku: string; name: string }) {
    return new ConflictException({
      code: 'PRODUCT_BARCODE_DUPLICATE',
      message: `الباركود مستخدم بالفعل للمنتج ${owner.sku} — ${owner.name} — This barcode already belongs to product ${owner.sku} (${owner.name}).`,
      productId: owner.id,
      sku: owner.sku,
      name: owner.name,
    });
  }

  private async mapWriteError(
    error: unknown,
    barcode?: string | null,
    excludeId?: string,
  ): Promise<Error> {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2002') {
        // Race safety: a concurrent write took the barcode between the check and the insert.
        const hitBarcodeIndex =
          error.message.includes('products_barcode_unique_active') ||
          JSON.stringify(error.meta ?? {}).includes('barcode');
        if (barcode && hitBarcodeIndex) {
          const owner = await this.findBarcodeOwner(barcode, excludeId);
          if (owner) return this.barcodeDuplicate(owner);
        }
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
