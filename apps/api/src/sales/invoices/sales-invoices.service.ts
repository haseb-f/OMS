import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  PartnerRoleType,
  Prisma,
  SalesDocumentStatus,
  SalesOrderDocument,
  SalesOrderDocumentItem,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { NumberingEngineService } from '../../numbering/numbering-engine.service';
import { ProductsService } from '../../products/products.service';
import { WarehousesService } from '../../warehouses/warehouses.service';
import { PartnersService } from '../../partners/partners.service';
import { InventoryService } from '../../inventory/inventory.service';
import { PostingEngineService } from '../../accounting/posting-engine/posting-engine.service';
import {
  SalesInvoiceActivityService,
  SalesInvoiceActivityType,
} from './activities/sales-invoice-activity.service';
import { SalesOrderDocumentActivityType } from '../orders/activities/sales-order-document-activity.service';
import {
  computeSalesDocumentTotals,
  computeSalesLine,
} from '../shared/sales-totals.util';
import { buildDateRangeFilter } from '../shared/sales-list-query.util';
import {
  computeInvoicePaymentSummary,
  resolveInvoicePaymentStatus,
  sumConfirmedAllocations,
} from '../../financial-transactions/shared/invoice-payment.util';
import type { CompanyContext } from '../../common/decorators/current-company-context.decorator';
import { CreateSalesInvoiceDto } from './dto/create-sales-invoice.dto';
import { UpdateSalesInvoiceDto } from './dto/update-sales-invoice.dto';
import { FindSalesInvoicesQueryDto } from './dto/find-sales-invoices-query.dto';
import type { SalesLineItemInputDto } from '../shared/sales-line-item-input.dto';
import { assertActiveProduct } from '../../products/assert-active-product.util';
import { prismaEnumFilter } from '../../common/query/enum-list';

const ORDER_REFERENCE_TYPE = 'SALES_ORDER_DOC';
const INVOICE_REFERENCE_TYPE = 'SALES_INVOICE';

interface ComputedInvoiceLines {
  lines: Prisma.SalesInvoiceItemUncheckedCreateWithoutSalesInvoiceInput[];
  totals: ReturnType<typeof computeSalesDocumentTotals>;
}

@Injectable()
export class SalesInvoicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly partnersService: PartnersService,
    private readonly productsService: ProductsService,
    private readonly warehousesService: WarehousesService,
    private readonly inventoryService: InventoryService,
    private readonly activityService: SalesInvoiceActivityService,
    private readonly numberingEngine: NumberingEngineService,
    private readonly postingEngine: PostingEngineService,
  ) {}

  async create(
    dto: CreateSalesInvoiceDto,
    context: CompanyContext = { companyId: null, branchId: null },
  ) {
    await this.partnersService.assertActiveForRole(
      dto.partnerId,
      PartnerRoleType.CUSTOMER,
    );
    const productsById = await this.productsService.findManyForValidation(
      dto.items.map((item) => item.productId),
    );
    for (const item of dto.items) {
      assertActiveProduct(item.productId, productsById);
      await this.assertInvoiceWarehouse(item.warehouseId);
    }
    const computed = await this.computeLines(dto.items);
    const invoiceNumber =
      await this.numberingEngine.generateNumber('SALES_INVOICE');

    return this.createInvoice(
      {
        invoiceNumber,
        partnerId: dto.partnerId,
        salesOrderId: null,
        currencyId: dto.currencyId ?? null,
        companyId: context.companyId,
        branchId: context.branchId,
        costCenterId: dto.costCenterId ?? null,
        projectId: dto.projectId ?? null,
        paymentTermId: null,
        referenceNumber: dto.referenceNumber ?? null,
        internalNotes: dto.internalNotes ?? null,
        customerNotes: dto.customerNotes ?? null,
      },
      computed,
      SalesInvoiceActivityType.INVOICE_CREATED,
      (invoice) => `Sales Invoice ${invoice.invoiceNumber} created`,
    );
  }

  /**
   * Called by SalesOrdersService.convertToInvoice — `lines` are already
   * resolved/validated (quantity capped at what's left undelivered on each
   * order line). Copies price/discount/tax from the order line as-is; flat
   * `discountValue` is not prorated for a partial quantity — a foundation-
   * phase simplification, noted for future refinement.
   */
  async createFromOrder(
    order: SalesOrderDocument & {
      items: SalesOrderDocumentItem[];
      partner?: {
        id: string;
        customerProfile?: { paymentTermId: string | null } | null;
      };
    },
    lines: { orderItem: SalesOrderDocumentItem; quantity: number }[],
    userId?: string,
  ) {
    const items: SalesLineItemInputDto[] = lines.map(
      ({ orderItem, quantity }) => ({
        productId: orderItem.productId,
        description: orderItem.description ?? undefined,
        warehouseId: orderItem.warehouseId,
        unitId: orderItem.unitId,
        quantity,
        unitPrice: Number(orderItem.unitPrice),
        discountPercent: Number(orderItem.discountPercent),
        discountValue: Number(orderItem.discountValue),
        taxId: orderItem.taxId ?? undefined,
        notes: orderItem.notes ?? undefined,
      }),
    );
    const computed = await this.computeLines(items);
    const invoiceNumber =
      await this.numberingEngine.generateNumber('SALES_INVOICE');

    // Links each computed line back to its source order line.
    const linesWithOrderRef = computed.lines.map((line, index) => ({
      ...line,
      salesOrderItemId: lines[index].orderItem.id,
    }));

    return this.createInvoice(
      {
        invoiceNumber,
        partnerId: order.partnerId,
        salesOrderId: order.id,
        currencyId: order.currencyId,
        companyId: order.companyId,
        branchId: order.branchId,
        paymentTermId: order.partner?.customerProfile?.paymentTermId ?? null,
        referenceNumber: order.referenceNumber,
        internalNotes: order.internalNotes,
        customerNotes: order.customerNotes,
      },
      { lines: linesWithOrderRef, totals: computed.totals },
      SalesInvoiceActivityType.INVOICE_CREATED_FROM_ORDER,
      (invoice) =>
        `Sales Invoice ${invoice.invoiceNumber} created from Sales Order ${order.orderNumber}`,
      userId,
    );
  }

  async findAll(query: FindSalesInvoicesQueryDto) {
    const where: Prisma.SalesInvoiceWhereInput = {
      deletedAt: null,
      partnerId: prismaEnumFilter(query.partnerId),
      status: prismaEnumFilter(query.status),
    };
    if (query.search) {
      where.OR = [
        { invoiceNumber: { contains: query.search, mode: 'insensitive' } },
        { referenceNumber: { contains: query.search, mode: 'insensitive' } },
      ];
    }
    if (query.dateFrom || query.dateTo) {
      where.createdAt = buildDateRangeFilter(query.dateFrom, query.dateTo);
    }

    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const [items, total] = await Promise.all([
      this.prisma.salesInvoice.findMany({
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
      this.prisma.salesInvoice.count({ where }),
    ]);

    const allocated = await sumConfirmedAllocations(
      this.prisma,
      'salesInvoiceId',
      items.map((invoice) => invoice.id),
    );
    const itemsWithPaymentStatus = items.map((invoice) => ({
      ...invoice,
      ...resolveInvoicePaymentStatus(
        computeInvoicePaymentSummary(
          Number(invoice.grandTotal),
          allocated.get(invoice.id) ?? 0,
        ),
        invoice.status,
      ),
    }));

    return { items: itemsWithPaymentStatus, total, page, pageSize };
  }

  async findOne(id: string) {
    const invoice = await this.prisma.salesInvoice.findFirst({
      where: { id, deletedAt: null },
      include: {
        partner: true,
        currency: true,
        salesOrder: { select: { orderNumber: true } },
        items: {
          include: { product: true, warehouse: true, unit: true, tax: true },
        },
        // TASK-050 — Related Documents: Sales Return(s) and Customer
        // Receipt(s) issued against this invoice, for the editor's
        // reference-links section. Read-only, no business logic.
        returns: {
          where: { deletedAt: null },
          select: { id: true, returnNumber: true, status: true },
        },
        allocations: {
          select: {
            id: true,
            allocatedAmount: true,
            transaction: {
              select: {
                id: true,
                transactionNumber: true,
                status: true,
              },
            },
          },
        },
      },
    });
    if (!invoice) {
      throw new NotFoundException(`Sales Invoice ${id} not found`);
    }
    // TASK-060B Part 6 — Payment Status, independent from Workflow Status.
    const confirmedAllocatedTotal = invoice.allocations
      .filter((allocation) => allocation.transaction.status === 'CONFIRMED')
      .reduce((sum, allocation) => sum + Number(allocation.allocatedAmount), 0);
    return {
      ...invoice,
      ...resolveInvoicePaymentStatus(
        computeInvoicePaymentSummary(
          Number(invoice.grandTotal),
          confirmedAllocatedTotal,
        ),
        invoice.status,
      ),
    };
  }

  async update(id: string, dto: UpdateSalesInvoiceDto) {
    const existing = await this.findOne(id);
    if (existing.status !== SalesDocumentStatus.DRAFT) {
      throw new BadRequestException('Only a Draft invoice can be edited.');
    }
    if (dto.partnerId) {
      await this.partnersService.assertActiveForRole(
        dto.partnerId,
        PartnerRoleType.CUSTOMER,
      );
    }

    let computed: ComputedInvoiceLines | undefined;
    if (dto.items) {
      const productsById = await this.productsService.findManyForValidation(
        dto.items.map((item) => item.productId),
      );
      for (const item of dto.items) {
        assertActiveProduct(item.productId, productsById);
        await this.assertInvoiceWarehouse(item.warehouseId);
      }
      computed = await this.computeLines(dto.items);
    }

    return this.prisma.$transaction(async (tx) => {
      if (dto.items) {
        await tx.salesInvoiceItem.deleteMany({
          where: { salesInvoiceId: id },
        });
      }
      const invoice = await tx.salesInvoice.update({
        where: { id },
        data: {
          partnerId: dto.partnerId,
          currencyId: dto.currencyId,
          referenceNumber: dto.referenceNumber,
          internalNotes: dto.internalNotes,
          customerNotes: dto.customerNotes,
          ...(computed
            ? { ...computed.totals, items: { create: computed.lines } }
            : {}),
        },
        include: {
          partner: true,
          currency: true,
          items: {
            include: { product: true, warehouse: true, unit: true, tax: true },
          },
        },
      });
      await this.activityService.log(
        id,
        SalesInvoiceActivityType.INVOICE_UPDATED,
        `Sales Invoice ${invoice.invoiceNumber} updated`,
        undefined,
        tx,
      );
      return invoice;
    });
  }

  submit(id: string) {
    return this.transition(
      id,
      [SalesDocumentStatus.DRAFT],
      SalesDocumentStatus.PENDING_APPROVAL,
      SalesInvoiceActivityType.INVOICE_SUBMITTED,
      'submitted for approval',
    );
  }

  approve(id: string) {
    return this.transition(
      id,
      [SalesDocumentStatus.PENDING_APPROVAL],
      SalesDocumentStatus.APPROVED,
      SalesInvoiceActivityType.INVOICE_APPROVED,
      'approved',
    );
  }

  /** A Confirmed invoice is never cancelled directly — only reversed via a Sales Return. */
  cancel(id: string, userId?: string) {
    return this.transition(
      id,
      [
        SalesDocumentStatus.DRAFT,
        SalesDocumentStatus.PENDING_APPROVAL,
        SalesDocumentStatus.APPROVED,
      ],
      SalesDocumentStatus.CANCELLED,
      SalesInvoiceActivityType.INVOICE_CANCELLED,
      'cancelled',
      { cancelledAt: new Date(), cancelledBy: userId ?? null },
    );
  }

  /**
   * Confirm = Reduce Inventory + release the matching Sales Order
   * reservation (if any) + roll the parent order's delivered quantity/
   * status up + mark "ready for accounting posting" (TASK-039 hand-off —
   * `postedToAccounting` itself stays false, this task never posts).
   */
  /**
   * Delivering stock, releasing the order's reservation, rolling up order
   * delivery status, and posting the invoice all run inside ONE transaction
   * (TASK-057) — a failure partway through must never leave stock
   * permanently delivered while the invoice stays Approved, which would
   * double-deliver on a retry.
   */
  async confirm(id: string, userId?: string) {
    const invoice = await this.findOne(id);
    if (invoice.status !== SalesDocumentStatus.APPROVED) {
      throw new BadRequestException(
        `Cannot confirm Sales Invoice ${invoice.invoiceNumber} from ${invoice.status}.`,
      );
    }

    return this.prisma.$transaction(async (tx) => {
      for (const item of invoice.items) {
        await this.inventoryService.postSalesDelivery(
          {
            productId: item.productId,
            warehouseId: item.warehouseId,
            quantity: item.quantity,
            referenceType: INVOICE_REFERENCE_TYPE,
            referenceId: invoice.id,
          },
          userId,
          tx,
        );

        if (item.salesOrderItemId && invoice.salesOrderId) {
          await this.inventoryService.release(
            {
              productId: item.productId,
              warehouseId: item.warehouseId,
              quantity: item.quantity,
              referenceType: ORDER_REFERENCE_TYPE,
              referenceId: invoice.salesOrderId,
            },
            userId,
            tx,
          );
        }
      }

      const updated = await tx.salesInvoice.update({
        where: { id },
        data: {
          status: SalesDocumentStatus.CONFIRMED,
          confirmedAt: new Date(),
          confirmedBy: userId ?? null,
        },
        include: {
          partner: true,
          currency: true,
          items: {
            include: { product: true, warehouse: true, unit: true, tax: true },
          },
        },
      });
      await this.activityService.log(
        id,
        SalesInvoiceActivityType.INVOICE_CONFIRMED,
        `Sales Invoice ${invoice.invoiceNumber} confirmed — inventory delivered`,
        undefined,
        tx,
      );

      if (invoice.salesOrderId) {
        await this.rollUpOrderDelivery(
          tx,
          invoice.salesOrderId,
          invoice.items
            .filter((item) => item.salesOrderItemId)
            .map((item) => ({
              orderItemId: item.salesOrderItemId as string,
              quantity: item.quantity,
            })),
        );
      }

      await this.postingEngine.post('SALES_INVOICE', id, userId, tx);

      return updated;
    });
  }

  /**
   * No dependency on SalesOrdersModule (that module already depends on this
   * one, for Order→Invoice conversion — avoiding a circular module import).
   * Bumps `deliveredQuantity` on each order line and rolls the order's own
   * status up to Partially Delivered / Delivered directly via Prisma.
   */
  private async rollUpOrderDelivery(
    tx: Prisma.TransactionClient,
    orderId: string,
    deliveries: { orderItemId: string; quantity: number }[],
  ) {
    for (const delivery of deliveries) {
      await tx.salesOrderDocumentItem.update({
        where: { id: delivery.orderItemId },
        data: { deliveredQuantity: { increment: delivery.quantity } },
      });
    }

    const order = await tx.salesOrderDocument.findUniqueOrThrow({
      where: { id: orderId },
      include: { items: true },
    });
    const fullyDelivered = order.items.every(
      (item) => item.deliveredQuantity >= item.quantity,
    );
    const anyDelivered = order.items.some((item) => item.deliveredQuantity > 0);
    const nextStatus = fullyDelivered
      ? SalesDocumentStatus.DELIVERED
      : anyDelivered
        ? SalesDocumentStatus.PARTIALLY_DELIVERED
        : order.status;

    if (nextStatus !== order.status) {
      await tx.salesOrderDocument.update({
        where: { id: orderId },
        data: { status: nextStatus },
      });
      await tx.salesOrderDocumentActivity.create({
        data: {
          salesOrderId: orderId,
          type: fullyDelivered
            ? SalesOrderDocumentActivityType.ORDER_DELIVERED
            : SalesOrderDocumentActivityType.ORDER_PARTIALLY_DELIVERED,
          description: fullyDelivered
            ? `Sales Order ${order.orderNumber} fully delivered`
            : `Sales Order ${order.orderNumber} partially delivered`,
        },
      });
    }
  }

  /**
   * Soft-delete — hides the invoice from findAll/findOne without destroying
   * data, mirroring the "Archive is soft-delete" pattern already used for
   * Product/Supplier. Allowed once the invoice is no longer actively
   * progressing: Draft/Cancelled/Closed, or Confirmed — a confirmed invoice
   * is already final (never cancelled directly, only reversed via a
   * Return), so it plays the same "done" role Closed plays elsewhere.
   */
  async archive(id: string, userId?: string) {
    const invoice = await this.findOne(id);
    const archivableFrom: SalesDocumentStatus[] = [
      SalesDocumentStatus.DRAFT,
      SalesDocumentStatus.CANCELLED,
      SalesDocumentStatus.CONFIRMED,
      SalesDocumentStatus.CLOSED,
    ];
    if (!archivableFrom.includes(invoice.status)) {
      throw new BadRequestException(
        `Cannot archive Sales Invoice ${invoice.invoiceNumber} while it is ${invoice.status}.`,
      );
    }
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.salesInvoice.update({
        where: { id },
        data: { deletedAt: new Date(), updatedBy: userId ?? null },
        include: {
          partner: true,
          currency: true,
          items: {
            include: { product: true, warehouse: true, unit: true, tax: true },
          },
        },
      });
      await this.activityService.log(
        id,
        SalesInvoiceActivityType.INVOICE_ARCHIVED,
        `Sales Invoice ${invoice.invoiceNumber} archived`,
        undefined,
        tx,
      );
      return updated;
    });
  }

  /**
   * Read-only — never writes. Returns the shape a future TASK-039
   * accounting posting would consume; no `ChartOfAccount`/journal entity
   * exists yet and none is created here.
   */
  async buildPostingPreview(id: string) {
    const invoice = await this.findOne(id);
    return {
      partnerId: invoice.partnerId,
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      lines: invoice.items.map((item) => ({
        productId: item.productId,
        amount: Number(item.lineTotal) - Number(item.taxAmount),
        taxAmount: Number(item.taxAmount),
      })),
      grandTotal: Number(invoice.grandTotal),
    };
  }

  private async transition(
    id: string,
    allowedFrom: SalesDocumentStatus[],
    to: SalesDocumentStatus,
    activityType: string,
    verb: string,
    extraData: Prisma.SalesInvoiceUpdateInput = {},
  ) {
    const invoice = await this.findOne(id);
    if (!allowedFrom.includes(invoice.status)) {
      throw new BadRequestException(
        `Cannot transition Sales Invoice ${invoice.invoiceNumber} from ${invoice.status} to ${to}.`,
      );
    }
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.salesInvoice.update({
        where: { id },
        data: { status: to, ...extraData },
        include: {
          partner: true,
          currency: true,
          items: {
            include: { product: true, warehouse: true, unit: true, tax: true },
          },
        },
      });
      await this.activityService.log(
        id,
        activityType,
        `Sales Invoice ${invoice.invoiceNumber} ${verb}`,
        undefined,
        tx,
      );
      return updated;
    });
  }

  private async createInvoice(
    header: {
      invoiceNumber: string;
      partnerId: string;
      salesOrderId: string | null;
      currencyId: string | null;
      companyId?: string | null;
      branchId?: string | null;
      costCenterId?: string | null;
      projectId?: string | null;
      paymentTermId: string | null;
      referenceNumber: string | null;
      internalNotes: string | null;
      customerNotes: string | null;
    },
    computed: ComputedInvoiceLines,
    activityType: string,
    describe: (invoice: { invoiceNumber: string }) => string,
    userId?: string,
  ) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const invoice = await tx.salesInvoice.create({
          data: {
            ...header,
            ...computed.totals,
            items: { create: computed.lines },
          },
          include: {
            partner: true,
            currency: true,
            items: {
              include: {
                product: true,
                warehouse: true,
                unit: true,
                tax: true,
              },
            },
          },
        });
        await this.activityService.log(
          invoice.id,
          activityType,
          describe(invoice),
          userId ? { createdBy: userId } : undefined,
          tx,
        );
        return invoice;
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2003'
      ) {
        throw new BadRequestException(
          'Invalid partner, currency, product, warehouse, unit, or tax reference.',
        );
      }
      throw error;
    }
  }

  private async assertInvoiceWarehouse(warehouseId: string | undefined) {
    if (!warehouseId) {
      throw new BadRequestException(
        'Warehouse is required on every Sales Invoice line.',
      );
    }
    const warehouse = await this.warehousesService.findOne(warehouseId);
    if (!warehouse.isActive) {
      throw new BadRequestException('Warehouse is inactive.');
    }
    return warehouse;
  }

  private async computeLines(
    items: SalesLineItemInputDto[],
  ): Promise<ComputedInvoiceLines> {
    const taxIds = [
      ...new Set(items.map((i) => i.taxId).filter((id): id is string => !!id)),
    ];
    const taxes =
      taxIds.length > 0
        ? await this.prisma.tax.findMany({ where: { id: { in: taxIds } } })
        : [];
    const taxRateById = new Map(taxes.map((t) => [t.id, Number(t.rate)]));

    const computedLines = items.map((item) =>
      computeSalesLine({
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        discountPercent: item.discountPercent,
        discountValue: item.discountValue,
        taxRatePercent: item.taxId ? taxRateById.get(item.taxId) : undefined,
      }),
    );

    const lines: Prisma.SalesInvoiceItemUncheckedCreateWithoutSalesInvoiceInput[] =
      items.map((item, index) => ({
        productId: item.productId,
        description: item.description,
        warehouseId: item.warehouseId as string,
        unitId: item.unitId,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        discountPercent: item.discountPercent ?? 0,
        discountValue: item.discountValue ?? 0,
        taxId: item.taxId,
        taxAmount: computedLines[index].taxAmount,
        lineTotal: computedLines[index].lineTotal,
        notes: item.notes,
      }));

    const totals = computeSalesDocumentTotals(computedLines);

    return { lines, totals };
  }
}
