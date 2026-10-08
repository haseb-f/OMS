import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  PartnerRoleType,
  Prisma,
  ProductSupplyMethod,
  ReturnItemCondition,
  SalesDocumentStatus,
  WarehouseRole,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { NumberingEngineService } from '../../numbering/numbering-engine.service';
import { ProductsService } from '../../products/products.service';
import { WarehousesService } from '../../warehouses/warehouses.service';
import { PartnersService } from '../../partners/partners.service';
import {
  InventoryService,
  lockProductsForUpdate,
} from '../../inventory/inventory.service';
import { movementIdempotencyKey } from '../../inventory/dto/movement-trace';
import {
  productsDeliveredThemselves,
  readKitSnapshot,
} from '../shared/kit-snapshot';
import { PostingEngineService } from '../../accounting/posting-engine/posting-engine.service';
import { resolveLineTaxes, resolveTaxesById } from '../../taxes/document-tax';
import {
  SalesReturnActivityService,
  SalesReturnActivityType,
} from './activities/sales-return-activity.service';
import {
  computeSalesDocumentTotals,
  computeSalesLine,
  round2,
} from '../shared/sales-totals.util';
import { buildDateRangeFilter } from '../shared/sales-list-query.util';
import { CreateSalesReturnDto } from './dto/create-sales-return.dto';
import { UpdateSalesReturnDto } from './dto/update-sales-return.dto';
import { FindSalesReturnsQueryDto } from './dto/find-sales-returns-query.dto';
import type { SalesLineItemInputDto } from '../shared/sales-line-item-input.dto';
import { assertActiveProduct } from '../../products/assert-active-product.util';
import { prismaEnumFilter } from '../../common/query/enum-list';
import { recomputeStoreOrderReturnStatus } from './store-order-return-status';

const REFERENCE_TYPE = 'SALES_RETURN';

/** Statuses of a return that is requested but not yet received (no stock / no posting yet). */
const REQUESTED_STATUSES: SalesDocumentStatus[] = [
  SalesDocumentStatus.DRAFT,
  SalesDocumentStatus.PENDING_APPROVAL,
  SalesDocumentStatus.APPROVED,
];
const POSTED_STATUSES: SalesDocumentStatus[] = [
  SalesDocumentStatus.CONFIRMED,
  SalesDocumentStatus.CLOSED,
];

const RETURN_INCLUDE = {
  partner: true,
  currency: true,
  items: {
    include: { product: true, warehouse: true, unit: true, tax: true },
  },
} satisfies Prisma.SalesReturnInclude;

interface ComputedReturnLines {
  lines: Prisma.SalesReturnItemUncheckedCreateWithoutSalesReturnInput[];
  totals: ReturnType<typeof computeSalesDocumentTotals>;
}

/** One requested line of a return raised from an invoice (R15, D15-10). */
export interface InvoiceReturnLineInput {
  salesInvoiceItemId: string;
  quantity: number;
}

/** The inspection result of one returned line at physical receipt. */
export interface ReturnInspectionLine {
  salesReturnItemId: string;
  condition: ReturnItemCondition;
  /** SALEABLE → a STOCK warehouse; DAMAGED → a DAMAGED-role warehouse. Defaulted when omitted. */
  warehouseId?: string;
}

type ReturnWithItems = Prisma.SalesReturnGetPayload<{
  include: typeof RETURN_INCLUDE;
}>;

@Injectable()
export class SalesReturnsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly partnersService: PartnersService,
    private readonly productsService: ProductsService,
    private readonly warehousesService: WarehousesService,
    private readonly inventoryService: InventoryService,
    private readonly activityService: SalesReturnActivityService,
    private readonly numberingEngine: NumberingEngineService,
    private readonly postingEngine: PostingEngineService,
  ) {}

  async create(dto: CreateSalesReturnDto) {
    await this.partnersService.assertActiveForRole(
      dto.partnerId,
      PartnerRoleType.CUSTOMER,
    );
    const sourceInvoice = await this.assertSourceInvoice(
      dto.salesInvoiceId,
      dto.partnerId,
    );
    const productsById = await this.productsService.findManyForValidation(
      dto.items.map((item) => item.productId),
    );
    const roles = new Map<string, WarehouseRole>();
    for (const item of dto.items) {
      assertActiveProduct(item.productId, productsById);
      const warehouse = await this.assertReturnWarehouse(item.warehouseId);
      roles.set(warehouse.id, warehouse.role);
      if (!item.salesInvoiceItemId) {
        throw new BadRequestException(
          'Every Sales Return line must reference a Sales Invoice line — a return cannot be created without a source invoice.',
        );
      }
      await this.assertReturnableQuantity(
        dto.salesInvoiceId,
        item.salesInvoiceItemId,
        item.quantity,
      );
    }
    const computed = await this.computeLines(dto.items, roles);
    const returnNumber =
      await this.numberingEngine.generateNumber('SALES_RETURN');

    try {
      return await this.prisma.$transaction(async (tx) => {
        const salesReturn = await tx.salesReturn.create({
          data: {
            returnNumber,
            partnerId: dto.partnerId,
            salesInvoiceId: dto.salesInvoiceId,
            // R15 — a return of a store order's invoice belongs to that order.
            storeOrderId: sourceInvoice.storeOrderId,
            currencyId: dto.currencyId,
            // TASK-051 Document Context Enrichment — inherited from the source invoice, never re-selected on the return.
            companyId: sourceInvoice.companyId,
            branchId: sourceInvoice.branchId,
            costCenterId: sourceInvoice.costCenterId,
            projectId: sourceInvoice.projectId,
            referenceNumber: dto.referenceNumber,
            internalNotes: dto.internalNotes,
            customerNotes: dto.customerNotes,
            ...computed.totals,
            items: { create: computed.lines },
          },
          include: RETURN_INCLUDE,
        });
        await this.activityService.log(
          salesReturn.id,
          SalesReturnActivityType.RETURN_CREATED,
          `Sales Return ${salesReturn.returnNumber} created`,
          undefined,
          tx,
        );
        return salesReturn;
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2003'
      ) {
        throw new BadRequestException(
          'Invalid partner, invoice, currency, product, warehouse, unit, or tax reference.',
        );
      }
      throw error;
    }
  }

  /**
   * R15 (D15-10) — "Return requested" raised from a posted (delivered)
   * invoice's lines: a DRAFT credit note with the reason, no stock effect
   * and no posting until the goods are received and inspected. Each line
   * mirrors its invoice line proportionally (amount, tax, discount), the
   * last return of a line taking the exact remainder, so returning every
   * unit reverses the invoice to the cent. Runs inside the caller's
   * transaction; the invoice row is locked so concurrent requests can never
   * exceed the invoiced quantity.
   */
  async createFromInvoiceLines(
    tx: Prisma.TransactionClient,
    input: {
      salesInvoiceId: string;
      storeOrderId: string | null;
      reason: string;
      lines: InvoiceReturnLineInput[];
      idempotencyKey?: string;
    },
    userId?: string,
  ) {
    await tx.$queryRaw`
      SELECT id FROM sales_invoices WHERE id = ${input.salesInvoiceId}::uuid FOR UPDATE
    `;
    const invoice = await tx.salesInvoice.findFirst({
      where: { id: input.salesInvoiceId, deletedAt: null },
      include: {
        items: {
          where: { deletedAt: null },
          include: {
            product: { select: { preferredWarehouseId: true, sku: true } },
          },
        },
      },
    });
    if (!invoice || !POSTED_STATUSES.includes(invoice.status)) {
      throw new BadRequestException(
        'لا يُنشأ مرتجع إلا من فاتورة مُرحّلة (بضاعة مُسلّمة) — A return is raised only from a posted invoice (delivered goods).',
      );
    }
    const itemById = new Map(invoice.items.map((item) => [item.id, item]));
    const seen = new Set<string>();
    for (const line of input.lines) {
      if (!itemById.has(line.salesInvoiceItemId)) {
        throw new BadRequestException(
          `Invoice item ${line.salesInvoiceItemId} does not belong to Sales Invoice ${invoice.invoiceNumber}.`,
        );
      }
      if (seen.has(line.salesInvoiceItemId)) {
        throw new BadRequestException(
          `Invoice line ${line.salesInvoiceItemId} appears more than once on this return.`,
        );
      }
      seen.add(line.salesInvoiceItemId);
    }
    const previous = await tx.salesReturnItem.groupBy({
      by: ['salesInvoiceItemId'],
      where: {
        salesInvoiceItemId: { in: [...seen] },
        salesReturn: {
          deletedAt: null,
          status: { not: SalesDocumentStatus.CANCELLED },
        },
      },
      _sum: {
        quantity: true,
        lineTotal: true,
        taxAmount: true,
        discountValue: true,
      },
    });
    const previousByLine = new Map(
      previous.map((row) => [row.salesInvoiceItemId, row._sum]),
    );
    const taxById = await resolveTaxesById(
      tx,
      invoice.items.map((item) => item.taxId),
    );

    const lines: Prisma.SalesReturnItemUncheckedCreateWithoutSalesReturnInput[] =
      [];
    const totals = {
      subtotal: 0,
      discountTotal: 0,
      taxTotal: 0,
      grandTotal: 0,
    };
    for (const line of input.lines) {
      const item = itemById.get(line.salesInvoiceItemId)!;
      const before = previousByLine.get(item.id);
      const returnedBefore = before?.quantity ?? 0;
      const remaining = item.quantity - returnedBefore;
      if (line.quantity > remaining) {
        throw new BadRequestException(
          `لا يمكن إرجاع ${line.quantity} — المتبقي القابل للإرجاع ${remaining} — Cannot return ${line.quantity} of ${item.product.sku}: only ${remaining} remains returnable on invoice ${invoice.invoiceNumber}.`,
        );
      }
      const share = (total: Prisma.Decimal, already: unknown) =>
        line.quantity === remaining
          ? round2(Number(total) - Number(already ?? 0))
          : round2((Number(total) * line.quantity) / item.quantity);
      const lineTotal = share(item.lineTotal, before?.lineTotal);
      const taxAmount = share(item.taxAmount, before?.taxAmount);
      const discountValue = share(item.discountValue, before?.discountValue);
      const inclusive = item.taxId
        ? (taxById.get(item.taxId)?.inclusive ?? false)
        : false;
      const lineSubtotal = round2(
        (inclusive ? lineTotal : lineTotal - taxAmount) + discountValue,
      );
      totals.subtotal = round2(totals.subtotal + lineSubtotal);
      totals.discountTotal = round2(totals.discountTotal + discountValue);
      totals.taxTotal = round2(totals.taxTotal + taxAmount);
      totals.grandTotal = round2(totals.grandTotal + lineTotal);
      lines.push({
        productId: item.productId,
        description: item.description,
        warehouseId: await this.defaultSaleableWarehouse(tx, {
          warehouseId: item.warehouseId,
          preferredWarehouseId: item.product.preferredWarehouseId,
        }),
        condition: ReturnItemCondition.SALEABLE,
        unitId: item.unitId,
        quantity: line.quantity,
        unitPrice: item.unitPrice,
        discountPercent: item.discountPercent,
        discountValue,
        taxId: item.taxId,
        salesInvoiceItemId: item.id,
        taxAmount,
        lineTotal,
      });
    }

    const returnNumber = await this.numberingEngine.generateNumber(
      'SALES_RETURN',
      undefined,
      tx,
    );
    const salesReturn = await tx.salesReturn.create({
      data: {
        returnNumber,
        partnerId: invoice.partnerId,
        salesInvoiceId: invoice.id,
        storeOrderId: input.storeOrderId,
        reason: input.reason,
        currencyId: invoice.currencyId,
        companyId: invoice.companyId,
        branchId: invoice.branchId,
        costCenterId: invoice.costCenterId,
        projectId: invoice.projectId,
        referenceNumber: invoice.invoiceNumber,
        createdBy: userId ?? null,
        updatedBy: userId ?? null,
        ...totals,
        items: { create: lines },
      },
      include: RETURN_INCLUDE,
    });
    await this.activityService.log(
      salesReturn.id,
      SalesReturnActivityType.RETURN_CREATED,
      `Sales Return ${salesReturn.returnNumber} requested against ${invoice.invoiceNumber}: ${input.reason} — no stock moves until the goods are received and inspected`,
      {
        storeOrderId: input.storeOrderId,
        reason: input.reason,
        idempotencyKey: input.idempotencyKey ?? null,
        userId: userId ?? null,
      },
      tx,
    );
    return salesReturn;
  }

  async findAll(query: FindSalesReturnsQueryDto) {
    const where: Prisma.SalesReturnWhereInput = {
      deletedAt: null,
      partnerId: prismaEnumFilter(query.partnerId),
      status: prismaEnumFilter(query.status),
    };
    if (query.search) {
      where.OR = [
        { returnNumber: { contains: query.search, mode: 'insensitive' } },
        { referenceNumber: { contains: query.search, mode: 'insensitive' } },
      ];
    }
    if (query.dateFrom || query.dateTo) {
      where.createdAt = buildDateRangeFilter(query.dateFrom, query.dateTo);
    }

    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const [items, total] = await Promise.all([
      this.prisma.salesReturn.findMany({
        where,
        include: {
          items: {
            include: {
              product: { select: { id: true, name: true, sku: true } },
            },
          },
          partner: true,
          currency: true,
        },
        orderBy: { [query.sortBy || 'createdAt']: query.sortOrder ?? 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.salesReturn.count({ where }),
    ]);

    return { items, total, page, pageSize };
  }

  async findOne(id: string) {
    const salesReturn = await this.prisma.salesReturn.findFirst({
      where: { id, deletedAt: null },
      include: {
        partner: true,
        currency: true,
        salesInvoice: { select: { invoiceNumber: true } },
        storeOrder: { select: { id: true, internalOrderId: true } },
        items: {
          include: { product: true, warehouse: true, unit: true, tax: true },
        },
      },
    });
    if (!salesReturn) {
      throw new NotFoundException(`Sales Return ${id} not found`);
    }
    return salesReturn;
  }

  /**
   * TASK-048 — read-only: per-line invoiced/already-returned/remaining
   * quantities for a Sales Invoice, so the "Create Return" flow can display
   * already-returned quantities and cap the requested quantity at what's
   * actually still returnable, instead of only discovering the cap from a
   * rejected submit. Mirrors `assertReturnableQuantity`'s own math exactly.
   */
  async returnableSummary(salesInvoiceId: string) {
    const invoice = await this.prisma.salesInvoice.findFirst({
      where: { id: salesInvoiceId, deletedAt: null },
      include: { items: true },
    });
    if (!invoice) {
      throw new NotFoundException(`Sales Invoice ${salesInvoiceId} not found`);
    }

    const returned = await this.prisma.salesReturnItem.groupBy({
      by: ['salesInvoiceItemId'],
      where: {
        salesInvoiceItemId: { in: invoice.items.map((item) => item.id) },
        salesReturn: { status: { not: SalesDocumentStatus.CANCELLED } },
      },
      _sum: { quantity: true },
    });
    const returnedById = new Map(
      returned.map((row) => [row.salesInvoiceItemId, row._sum.quantity ?? 0]),
    );

    return {
      items: invoice.items.map((item) => {
        const returnedQuantity = returnedById.get(item.id) ?? 0;
        return {
          salesInvoiceItemId: item.id,
          invoicedQuantity: item.quantity,
          returnedQuantity,
          remainingQuantity: item.quantity - returnedQuantity,
        };
      }),
    };
  }

  async update(id: string, dto: UpdateSalesReturnDto) {
    const existing = await this.findOne(id);
    if (existing.status !== SalesDocumentStatus.DRAFT) {
      throw new BadRequestException('Only a Draft return can be edited.');
    }
    if (dto.partnerId) {
      await this.partnersService.assertActiveForRole(
        dto.partnerId,
        PartnerRoleType.CUSTOMER,
      );
    }

    let computed: ComputedReturnLines | undefined;
    if (dto.items) {
      const salesInvoiceId = dto.salesInvoiceId ?? existing.salesInvoiceId;
      if (!salesInvoiceId) {
        throw new BadRequestException(
          'This Sales Return has no source Sales Invoice — reference one before editing lines.',
        );
      }
      const productsById = await this.productsService.findManyForValidation(
        dto.items.map((item) => item.productId),
      );
      const roles = new Map<string, WarehouseRole>();
      for (const item of dto.items) {
        assertActiveProduct(item.productId, productsById);
        const warehouse = await this.assertReturnWarehouse(item.warehouseId);
        roles.set(warehouse.id, warehouse.role);
        if (!item.salesInvoiceItemId) {
          throw new BadRequestException(
            'Every Sales Return line must reference a Sales Invoice line — a return cannot be created without a source invoice.',
          );
        }
        await this.assertReturnableQuantity(
          salesInvoiceId,
          item.salesInvoiceItemId,
          item.quantity,
          id,
        );
      }
      computed = await this.computeLines(dto.items, roles);
    }

    return this.prisma.$transaction(async (tx) => {
      if (dto.items) {
        await tx.salesReturnItem.deleteMany({
          where: { salesReturnId: id },
        });
      }
      const salesReturn = await tx.salesReturn.update({
        where: { id },
        data: {
          partnerId: dto.partnerId,
          salesInvoiceId: dto.salesInvoiceId,
          currencyId: dto.currencyId,
          referenceNumber: dto.referenceNumber,
          internalNotes: dto.internalNotes,
          customerNotes: dto.customerNotes,
          ...(computed
            ? { ...computed.totals, items: { create: computed.lines } }
            : {}),
        },
        include: RETURN_INCLUDE,
      });
      await this.activityService.log(
        id,
        SalesReturnActivityType.RETURN_UPDATED,
        `Sales Return ${salesReturn.returnNumber} updated`,
        undefined,
        tx,
      );
      return salesReturn;
    });
  }

  submit(id: string) {
    return this.transition(
      id,
      [SalesDocumentStatus.DRAFT],
      SalesDocumentStatus.PENDING_APPROVAL,
      SalesReturnActivityType.RETURN_SUBMITTED,
      'submitted for approval',
    );
  }

  approve(id: string) {
    return this.transition(
      id,
      [SalesDocumentStatus.PENDING_APPROVAL],
      SalesDocumentStatus.APPROVED,
      SalesReturnActivityType.RETURN_APPROVED,
      'approved',
    );
  }

  cancel(id: string, userId?: string) {
    return this.transition(
      id,
      [
        SalesDocumentStatus.DRAFT,
        SalesDocumentStatus.PENDING_APPROVAL,
        SalesDocumentStatus.APPROVED,
      ],
      SalesDocumentStatus.CANCELLED,
      SalesReturnActivityType.RETURN_CANCELLED,
      'cancelled',
      { cancelledAt: new Date(), cancelledBy: userId ?? null },
    );
  }

  /** Confirm = Increase Inventory. */
  /** Increasing stock and posting the return run inside ONE transaction (TASK-057) — same atomicity reasoning as SalesInvoicesService.confirm. */
  async confirm(id: string, userId?: string) {
    const salesReturn = await this.findOne(id);
    if (salesReturn.status !== SalesDocumentStatus.APPROVED) {
      throw new BadRequestException(
        `Cannot confirm Sales Return ${salesReturn.returnNumber} from ${salesReturn.status}.`,
      );
    }

    return this.prisma.$transaction((tx) =>
      this.confirmInTx(
        tx,
        salesReturn,
        userId,
        `Sales Return ${salesReturn.returnNumber} confirmed — inventory increased`,
      ),
    );
  }

  /**
   * R15 (D15-10) — "Receive & inspect": the physical receipt of requested
   * goods. Per line the inspection sets the condition and destination —
   * SALEABLE → a STOCK warehouse (default: the invoice line's warehouse, or
   * the product's preferred / the default stock warehouse — never goods in
   * transit), DAMAGED → a damaged-goods warehouse (default WH-DAMAGED) —
   * then the existing confirm restocks and posts the credit note (revenue +
   * COGS reversed at the invoice snapshot cost; damaged goods come back
   * into inventory value in the damaged warehouse — a write-off is a later,
   * separate inventory decision). Inside the caller's transaction; a retry
   * of an already received return returns it unchanged.
   */
  async receiveInTx(
    tx: Prisma.TransactionClient,
    id: string,
    inspection: ReturnInspectionLine[],
    userId?: string,
  ) {
    await tx.$queryRaw`SELECT id FROM sales_returns WHERE id = ${id}::uuid FOR UPDATE`;
    const current = await tx.salesReturn.findFirst({
      where: { id, deletedAt: null },
      include: RETURN_INCLUDE,
    });
    if (!current) throw new NotFoundException(`Sales Return ${id} not found`);
    if (POSTED_STATUSES.includes(current.status)) return current;
    if (!REQUESTED_STATUSES.includes(current.status)) {
      throw new BadRequestException(
        `Cannot receive Sales Return ${current.returnNumber} — it is ${current.status}.`,
      );
    }
    const byItem = new Map(
      inspection.map((line) => [line.salesReturnItemId, line]),
    );
    for (const line of inspection) {
      if (!current.items.some((item) => item.id === line.salesReturnItemId)) {
        throw new BadRequestException(
          `Line ${line.salesReturnItemId} is not on Sales Return ${current.returnNumber}.`,
        );
      }
    }
    const invoiceLines = await tx.salesInvoiceItem.findMany({
      where: {
        id: {
          in: current.items
            .map((item) => item.salesInvoiceItemId)
            .filter((value): value is string => !!value),
        },
      },
      select: { id: true, warehouseId: true },
    });
    const invoiceWarehouse = new Map(
      invoiceLines.map((line) => [line.id, line.warehouseId]),
    );
    for (const item of current.items) {
      const checked = byItem.get(item.id);
      const condition = checked?.condition ?? ReturnItemCondition.SALEABLE;
      const warehouseId =
        condition === ReturnItemCondition.DAMAGED
          ? await this.damagedWarehouse(tx, checked?.warehouseId)
          : checked?.warehouseId
            ? await this.assertWarehouseRole(
                tx,
                checked.warehouseId,
                WarehouseRole.STOCK,
              )
            : await this.defaultSaleableWarehouse(tx, {
                warehouseId: item.salesInvoiceItemId
                  ? (invoiceWarehouse.get(item.salesInvoiceItemId) ?? null)
                  : item.warehouseId,
                preferredWarehouseId: item.product.preferredWarehouseId,
              });
      await tx.salesReturnItem.update({
        where: { id: item.id },
        data: { condition, warehouseId, updatedBy: userId ?? null },
      });
    }
    const inspected = await tx.salesReturn.findUniqueOrThrow({
      where: { id },
      include: RETURN_INCLUDE,
    });
    const damaged = inspected.items.filter(
      (item) => item.condition === ReturnItemCondition.DAMAGED,
    ).length;
    return this.confirmInTx(
      tx,
      inspected,
      userId,
      `Sales Return ${inspected.returnNumber} received and inspected — ${inspected.items.length - damaged} line(s) saleable back to stock, ${damaged} damaged to the damaged-goods warehouse; credit note posted`,
    );
  }

  /** Restock + CONFIRMED + credit note posting + the order's return status, in the caller's transaction. */
  private async confirmInTx(
    tx: Prisma.TransactionClient,
    salesReturn: Pick<
      ReturnWithItems,
      'id' | 'returnNumber' | 'storeOrderId' | 'salesInvoiceId' | 'items'
    >,
    userId: string | undefined,
    description: string,
  ) {
    await this.returnStock(tx, salesReturn, userId);

    const updated = await tx.salesReturn.update({
      where: { id: salesReturn.id },
      data: {
        status: SalesDocumentStatus.CONFIRMED,
        confirmedAt: new Date(),
        confirmedBy: userId ?? null,
      },
      include: RETURN_INCLUDE,
    });
    await this.activityService.log(
      salesReturn.id,
      SalesReturnActivityType.RETURN_CONFIRMED,
      description,
      undefined,
      tx,
    );
    await this.postingEngine.post('SALES_RETURN', salesReturn.id, userId, tx);
    const storeOrderId =
      salesReturn.storeOrderId ??
      (salesReturn.salesInvoiceId
        ? (
            await tx.salesInvoice.findUnique({
              where: { id: salesReturn.salesInvoiceId },
              select: { storeOrderId: true },
            })
          )?.storeOrderId
        : null);
    if (storeOrderId) {
      await recomputeStoreOrderReturnStatus(tx, storeOrderId);
    }
    return updated;
  }

  /**
   * R13 — the stock side of confirming a return:
   *  - a service / non-stock line returns nothing (F12: it used to fail);
   *  - a kit line returns its COMPONENTS, as recorded in the invoice line's
   *    `fulfillmentSnapshot` (recipe + quantity per kit) — never the kit's
   *    current recipe; the movements carry the kit and recipe;
   *  - a stocked line returns itself.
   * Every product row is locked once up front; each movement is keyed per
   * return line (+ component) so a repeated confirm can never post it twice.
   * The valuation / journal side (snapshot costs) is the posting provider's.
   */
  private async returnStock(
    tx: Prisma.TransactionClient,
    salesReturn: {
      id: string;
      returnNumber: string;
      items: Array<{
        id: string;
        productId: string;
        warehouseId: string;
        quantity: number;
        salesInvoiceItemId: string | null;
        product: {
          sku: string;
          isInventoryItem: boolean;
          supplyMethod: ProductSupplyMethod;
        };
      }>;
    },
    userId?: string,
  ) {
    const invoiceLines = await tx.salesInvoiceItem.findMany({
      where: {
        id: {
          in: salesReturn.items
            .map((item) => item.salesInvoiceItemId)
            .filter((id): id is string => Boolean(id)),
        },
      },
      select: { id: true, salesInvoiceId: true, fulfillmentSnapshot: true },
    });
    const invoiceOfLine = new Map(
      invoiceLines.map((line) => [line.id, line.salesInvoiceId]),
    );
    const snapshotByLine = new Map(
      invoiceLines.map((line) => [
        line.id,
        readKitSnapshot(line.fulfillmentSnapshot),
      ]),
    );
    const movements: Array<{
      key: string;
      productId: string;
      warehouseId: string;
      quantity: number;
      parentProductId?: string;
      recipeId?: string;
    }> = [];
    for (const item of salesReturn.items) {
      const kit = item.salesInvoiceItemId
        ? snapshotByLine.get(item.salesInvoiceItemId)
        : null;
      if (kit) {
        for (const component of kit.components) {
          movements.push({
            key: `${item.id}:${component.productId}`,
            productId: component.productId,
            warehouseId: item.warehouseId,
            quantity: component.qtyPerKit * item.quantity,
            parentProductId: item.productId,
            recipeId: kit.recipeId,
          });
        }
        continue;
      }
      if (item.product.supplyMethod === ProductSupplyMethod.KIT) {
        // R13 L7 — decided by the line's history, not the current supply
        // method: a line sold as a stocked item before the product became a
        // kit delivered the product itself. Its units would have to come back
        // as stock of a product that no longer holds any.
        const invoiceId = item.salesInvoiceItemId
          ? invoiceOfLine.get(item.salesInvoiceItemId)
          : undefined;
        const soldFromStock =
          invoiceId &&
          (
            await productsDeliveredThemselves(tx, [
              { salesInvoiceId: invoiceId, productId: item.productId },
            ])
          ).size > 0;
        if (soldFromStock) {
          throw new UnprocessableEntityException({
            code: 'SALES_RETURN_PRODUCT_NOT_STOCKED',
            message: `${item.product.sku} was sold from stock on its invoice but is now a kit, which holds no stock of its own — it cannot be received back on ${salesReturn.returnNumber} until it is set to a stock-tracked supply method again.`,
          });
        }
        throw new BadRequestException({
          code: 'KIT_RETURN_SNAPSHOT_MISSING',
          message: `Kit ${item.product.sku} cannot be returned on ${salesReturn.returnNumber} — its invoice line has no fulfillment snapshot of the components delivered.`,
        });
      }
      if (!item.product.isInventoryItem) continue;
      movements.push({
        key: item.id,
        productId: item.productId,
        warehouseId: item.warehouseId,
        quantity: item.quantity,
      });
    }
    if (movements.length === 0) return;
    await lockProductsForUpdate(
      tx,
      movements.map((movement) => movement.productId),
    );
    for (const movement of movements) {
      await this.inventoryService.postSalesReturn(
        {
          productId: movement.productId,
          warehouseId: movement.warehouseId,
          quantity: movement.quantity,
          referenceType: REFERENCE_TYPE,
          referenceId: salesReturn.id,
          idempotencyKey: movementIdempotencyKey(
            REFERENCE_TYPE,
            salesReturn.id,
            movement.key,
            'SALES_RETURN',
          ),
          ...(movement.parentProductId
            ? {
                parentProductId: movement.parentProductId,
                recipeId: movement.recipeId,
              }
            : {}),
        },
        userId,
        tx,
      );
    }
  }

  /**
   * Soft-delete — hides the return from findAll/findOne without destroying
   * data, mirroring the "Archive is soft-delete" pattern already used for
   * Product/Supplier. Allowed once the return is no longer actively
   * progressing: Draft/Cancelled/Closed, or Confirmed — a confirmed return
   * has already posted its inventory increase and is effectively final.
   */
  async archive(id: string, userId?: string) {
    const salesReturn = await this.findOne(id);
    const archivableFrom: SalesDocumentStatus[] = [
      SalesDocumentStatus.DRAFT,
      SalesDocumentStatus.CANCELLED,
      SalesDocumentStatus.CONFIRMED,
      SalesDocumentStatus.CLOSED,
    ];
    if (!archivableFrom.includes(salesReturn.status)) {
      throw new BadRequestException(
        `Cannot archive Sales Return ${salesReturn.returnNumber} while it is ${salesReturn.status}.`,
      );
    }
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.salesReturn.update({
        where: { id },
        data: { deletedAt: new Date(), updatedBy: userId ?? null },
        include: RETURN_INCLUDE,
      });
      await this.activityService.log(
        id,
        SalesReturnActivityType.RETURN_ARCHIVED,
        `Sales Return ${salesReturn.returnNumber} archived`,
        undefined,
        tx,
      );
      return updated;
    });
  }

  private async transition(
    id: string,
    allowedFrom: SalesDocumentStatus[],
    to: SalesDocumentStatus,
    activityType: string,
    verb: string,
    extraData: Prisma.SalesReturnUpdateInput = {},
  ) {
    const salesReturn = await this.findOne(id);
    if (!allowedFrom.includes(salesReturn.status)) {
      throw new BadRequestException(
        `Cannot transition Sales Return ${salesReturn.returnNumber} from ${salesReturn.status} to ${to}.`,
      );
    }
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.salesReturn.update({
        where: { id },
        data: { status: to, ...extraData },
        include: RETURN_INCLUDE,
      });
      await this.activityService.log(
        id,
        activityType,
        `Sales Return ${salesReturn.returnNumber} ${verb}`,
        undefined,
        tx,
      );
      return updated;
    });
  }

  /**
   * Every return line needs an active destination warehouse; goods in
   * transit (the TRANSIT-role system warehouse) are never a return
   * destination (R15, D15-4).
   */
  private async assertReturnWarehouse(warehouseId: string | undefined) {
    if (!warehouseId) {
      throw new BadRequestException(
        'Warehouse is required on every Sales Return line.',
      );
    }
    const warehouse = await this.warehousesService.findOne(warehouseId);
    if (!warehouse.isActive) {
      throw new BadRequestException('Warehouse is inactive.');
    }
    if (warehouse.role === WarehouseRole.TRANSIT) {
      throw new BadRequestException(
        `المستودع ${warehouse.code} مخصص للبضاعة في الطريق ولا يستقبل المرتجعات — ${warehouse.code} holds goods in transit and is never a return destination; choose a stock or damaged-goods warehouse.`,
      );
    }
    return warehouse;
  }

  /** The warehouse exists, is active and has the expected role (else a clear 400). */
  private async assertWarehouseRole(
    tx: Prisma.TransactionClient,
    warehouseId: string,
    role: WarehouseRole,
  ): Promise<string> {
    const warehouse = await tx.warehouse.findFirst({
      where: { id: warehouseId, deletedAt: null },
      select: { id: true, code: true, isActive: true, role: true },
    });
    if (!warehouse || !warehouse.isActive) {
      throw new BadRequestException('Warehouse not found or inactive.');
    }
    if (warehouse.role !== role) {
      throw new BadRequestException(
        role === WarehouseRole.DAMAGED
          ? `البضاعة التالفة تُستلم في مستودع التالف فقط — Damaged goods go to a damaged-goods warehouse; ${warehouse.code} is not one.`
          : `البضاعة السليمة تُستلم في مستودع مخزون — Saleable goods go back to a stock warehouse; ${warehouse.code} is not one.`,
      );
    }
    return warehouse.id;
  }

  /** The chosen damaged-goods warehouse, or the system one (WH-DAMAGED first). */
  private async damagedWarehouse(
    tx: Prisma.TransactionClient,
    chosen?: string,
  ): Promise<string> {
    if (chosen) {
      return this.assertWarehouseRole(tx, chosen, WarehouseRole.DAMAGED);
    }
    const candidates = await tx.warehouse.findMany({
      where: { role: WarehouseRole.DAMAGED, isActive: true, deletedAt: null },
      select: { id: true, code: true },
      orderBy: { createdAt: 'asc' },
    });
    const warehouse =
      candidates.find((row) => row.code === 'WH-DAMAGED') ?? candidates[0];
    if (!warehouse) {
      throw new BadRequestException(
        'لا يوجد مستودع للبضاعة التالفة — No active damaged-goods warehouse is configured.',
      );
    }
    return warehouse.id;
  }

  /**
   * Where saleable goods go back by default: the line's own warehouse when
   * it is an active STOCK warehouse (never goods in transit), else the
   * product's preferred stock warehouse, else the default stock warehouse.
   */
  private async defaultSaleableWarehouse(
    tx: Prisma.TransactionClient,
    line: { warehouseId: string | null; preferredWarehouseId: string | null },
  ): Promise<string> {
    const candidates = [line.warehouseId, line.preferredWarehouseId].filter(
      (id): id is string => !!id,
    );
    const usable = await tx.warehouse.findMany({
      where: {
        OR: [{ id: { in: candidates } }, { isDefault: true }],
        role: WarehouseRole.STOCK,
        isActive: true,
        deletedAt: null,
      },
      select: { id: true, isDefault: true },
    });
    const found =
      candidates
        .map((id) => usable.find((row) => row.id === id))
        .find((row) => row) ?? usable.find((row) => row.isDefault);
    if (!found) {
      throw new BadRequestException(
        'لا يوجد مستودع مخزون لاستلام المرتجع — No active stock warehouse can receive this return; choose one.',
      );
    }
    return found.id;
  }

  /**
   * TASK-048 — verifies the invoice item genuinely belongs to the given
   * Sales Invoice (a caller can't reference an unrelated invoice's line),
   * then caps returned quantity at invoiced quantity minus already-returned
   * (across non-cancelled returns). `excludeReturnId` omits the return
   * being edited from the "already returned" sum — otherwise re-saving an
   * existing return's own unchanged lines would double-count itself.
   */
  private async assertReturnableQuantity(
    salesInvoiceId: string,
    salesInvoiceItemId: string,
    quantity: number,
    excludeReturnId?: string,
  ) {
    const invoiceItem = await this.prisma.salesInvoiceItem.findUnique({
      where: { id: salesInvoiceItemId },
    });
    if (!invoiceItem || invoiceItem.salesInvoiceId !== salesInvoiceId) {
      throw new BadRequestException(
        `Invoice item ${salesInvoiceItemId} does not belong to Sales Invoice ${salesInvoiceId}.`,
      );
    }
    const alreadyReturned = await this.prisma.salesReturnItem.aggregate({
      where: {
        salesInvoiceItemId,
        salesReturn: {
          status: { not: SalesDocumentStatus.CANCELLED },
          ...(excludeReturnId ? { id: { not: excludeReturnId } } : {}),
        },
      },
      _sum: { quantity: true },
    });
    const remaining =
      invoiceItem.quantity - (alreadyReturned._sum.quantity ?? 0);
    if (quantity > remaining) {
      throw new BadRequestException(
        `Cannot return ${quantity} — only ${remaining} remains returnable on this invoice line.`,
      );
    }
  }

  /** TASK-048 — the return's partner must match its source invoice's partner; the invoice must exist and not be deleted. */
  private async assertSourceInvoice(salesInvoiceId: string, partnerId: string) {
    const invoice = await this.prisma.salesInvoice.findFirst({
      where: { id: salesInvoiceId, deletedAt: null },
      select: {
        partnerId: true,
        status: true,
        invoiceNumber: true,
        storeOrderId: true,
        companyId: true,
        branchId: true,
        costCenterId: true,
        projectId: true,
      },
    });
    if (!invoice) {
      throw new NotFoundException(`Sales Invoice ${salesInvoiceId} not found`);
    }
    if (invoice.partnerId !== partnerId) {
      throw new BadRequestException(
        'Sales Return partner must match the source Sales Invoice partner.',
      );
    }
    // TASK-050 — a cancelled invoice can never be returned against.
    if (invoice.status === SalesDocumentStatus.CANCELLED) {
      throw new BadRequestException(
        `Cannot create a return against cancelled Sales Invoice ${invoice.invoiceNumber}.`,
      );
    }
    return invoice;
  }

  private async computeLines(
    items: SalesLineItemInputDto[],
    /** Role of each line's warehouse: a damaged-goods warehouse receives the line as DAMAGED. */
    roles: Map<string, WarehouseRole>,
  ): Promise<ComputedReturnLines> {
    const { taxIds, taxById } = await resolveLineTaxes(this.prisma, items);

    const computedLines = items.map((item, index) => {
      const taxId = taxIds[index];
      const tax = taxId ? taxById.get(taxId) : undefined;
      return computeSalesLine({
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        discountPercent: item.discountPercent,
        discountValue: item.discountValue,
        taxRatePercent: tax?.rate,
        taxInclusive: tax?.inclusive,
      });
    });

    const lines: Prisma.SalesReturnItemUncheckedCreateWithoutSalesReturnInput[] =
      items.map((item, index) => ({
        productId: item.productId,
        description: item.description,
        warehouseId: item.warehouseId as string,
        condition:
          roles.get(item.warehouseId as string) === WarehouseRole.DAMAGED
            ? ReturnItemCondition.DAMAGED
            : ReturnItemCondition.SALEABLE,
        unitId: item.unitId,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        discountPercent: item.discountPercent ?? 0,
        discountValue: item.discountValue ?? 0,
        taxId: taxIds[index],
        salesInvoiceItemId: item.salesInvoiceItemId,
        taxAmount: computedLines[index].taxAmount,
        lineTotal: computedLines[index].lineTotal,
        notes: item.notes,
      }));

    const totals = computeSalesDocumentTotals(computedLines);

    return { lines, totals };
  }
}
