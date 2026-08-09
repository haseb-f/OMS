import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  ProductStatus,
  PurchaseDocumentStatus,
  PurchaseOrder,
  PurchaseOrderItem,
  PurchaseOrderStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { NumberingEngineService } from '../../numbering/numbering-engine.service';
import { ProductsService } from '../../products/products.service';
import { WarehousesService } from '../../warehouses/warehouses.service';
import { SuppliersService } from '../../suppliers/suppliers.service';
import { InventoryService } from '../../inventory/inventory.service';
import { PostingEngineService } from '../../accounting/posting-engine/posting-engine.service';
import {
  PurchaseInvoiceActivityService,
  PurchaseInvoiceActivityType,
} from './activities/purchase-invoice-activity.service';
import {
  computeSalesDocumentTotals,
  computeSalesLine,
} from '../../sales/shared/sales-totals.util';
import { buildDateRangeFilter } from '../../sales/shared/sales-list-query.util';
import {
  computeInvoicePaymentSummary,
  resolveInvoicePaymentStatus,
  sumConfirmedAllocations,
} from '../../financial-transactions/shared/invoice-payment.util';
import type { CompanyContext } from '../../common/decorators/current-company-context.decorator';
import { CreatePurchaseInvoiceDto } from './dto/create-purchase-invoice.dto';
import { UpdatePurchaseInvoiceDto } from './dto/update-purchase-invoice.dto';
import { FindPurchaseInvoicesQueryDto } from './dto/find-purchase-invoices-query.dto';
import type { PurchaseLineItemInputDto } from '../shared/purchase-line-item-input.dto';

const INVOICE_REFERENCE_TYPE = 'PURCHASE_INVOICE';

const PO_ACTIVITY_TYPE = { PO_CLOSED: 'PO_CLOSED' };

interface ComputedInvoiceLines {
  lines: Prisma.PurchaseInvoiceItemUncheckedCreateWithoutPurchaseInvoiceInput[];
  totals: ReturnType<typeof computeSalesDocumentTotals>;
}

@Injectable()
export class PurchaseInvoicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly suppliersService: SuppliersService,
    private readonly productsService: ProductsService,
    private readonly warehousesService: WarehousesService,
    private readonly inventoryService: InventoryService,
    private readonly activityService: PurchaseInvoiceActivityService,
    private readonly numberingEngine: NumberingEngineService,
    private readonly postingEngine: PostingEngineService,
  ) {}

  async create(
    dto: CreatePurchaseInvoiceDto,
    context: CompanyContext = { companyId: null, branchId: null },
  ) {
    await this.suppliersService.assertActiveSupplier(dto.supplierId);
    for (const item of dto.items) {
      await this.assertActiveProduct(item.productId);
      await this.assertInvoiceWarehouse(item.warehouseId);
    }
    const computed = await this.computeLines(dto.items);
    const invoiceNumber =
      await this.numberingEngine.generateNumber('PURCHASE_INVOICE');

    return this.createInvoice(
      {
        invoiceNumber,
        supplierId: dto.supplierId,
        purchaseOrderId: null,
        currencyId: dto.currencyId ?? null,
        companyId: context.companyId,
        branchId: context.branchId,
        costCenterId: dto.costCenterId ?? null,
        projectId: dto.projectId ?? null,
        referenceNumber: dto.referenceNumber ?? null,
        internalNotes: dto.internalNotes ?? null,
        supplierNotes: dto.supplierNotes ?? null,
      },
      computed,
      PurchaseInvoiceActivityType.INVOICE_CREATED,
      (invoice) => `Purchase Invoice ${invoice.invoiceNumber} created`,
    );
  }

  /**
   * Called by PurchaseOrdersService.convertToInvoice — every PO line
   * converts as-is (no partial receipt tracking on PurchaseOrderItem), at
   * the single `warehouseId` the caller supplied for the whole receipt.
   * Copies price/discount from the PO line; PurchaseOrderItem carries no
   * tax field (Phase 1), so `taxId` is left unset on every converted line —
   * still editable afterward while the Invoice stays Draft, same as the
   * "flat discountValue not prorated" simplification Sales documents this
   * exact bridge-point limitation with.
   */
  async createFromOrder(
    order: PurchaseOrder,
    items: PurchaseOrderItem[],
    warehouseId: string,
    userId?: string,
  ) {
    await this.assertInvoiceWarehouse(warehouseId);

    const lineInputs: PurchaseLineItemInputDto[] = items.map((item) => ({
      productId: item.productId,
      description: item.description ?? undefined,
      warehouseId,
      unitId: item.unitId ?? undefined,
      quantity: item.quantity,
      unitPrice: Number(item.unitPrice),
      discountPercent: Number(item.discountPercent),
      discountValue: Number(item.discountValue),
    })) as PurchaseLineItemInputDto[];

    for (const line of lineInputs) {
      if (!line.unitId) {
        throw new BadRequestException(
          `Purchase Order line for product ${line.productId} has no Unit — cannot receive.`,
        );
      }
    }

    const computed = await this.computeLines(lineInputs);
    const invoiceNumber =
      await this.numberingEngine.generateNumber('PURCHASE_INVOICE');

    const linesWithOrderRef = computed.lines.map((line, index) => ({
      ...line,
      purchaseOrderItemId: items[index].id,
    }));

    return this.createInvoice(
      {
        invoiceNumber,
        supplierId: order.supplierId,
        purchaseOrderId: order.id,
        currencyId: order.currencyId,
        companyId: order.companyId,
        branchId: order.branchId,
        costCenterId: order.costCenterId,
        projectId: order.projectId,
        referenceNumber: order.referenceNumber,
        internalNotes: order.internalNotes,
        supplierNotes: order.supplierNotes,
      },
      { lines: linesWithOrderRef, totals: computed.totals },
      PurchaseInvoiceActivityType.INVOICE_CREATED_FROM_ORDER,
      (invoice) =>
        `Purchase Invoice ${invoice.invoiceNumber} created from Purchase Order ${order.poNumber}`,
      userId,
    );
  }

  async findAll(query: FindPurchaseInvoicesQueryDto) {
    const where: Prisma.PurchaseInvoiceWhereInput = {
      deletedAt: null,
      supplierId: query.supplierId,
      status: query.status,
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
      this.prisma.purchaseInvoice.findMany({
        where,
        include: { items: true, supplier: true, currency: true },
        orderBy: { [query.sortBy || 'createdAt']: query.sortOrder ?? 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.purchaseInvoice.count({ where }),
    ]);

    const allocated = await sumConfirmedAllocations(
      this.prisma,
      'purchaseInvoiceId',
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
    const invoice = await this.prisma.purchaseInvoice.findFirst({
      where: { id, deletedAt: null },
      include: {
        supplier: true,
        currency: true,
        purchaseOrder: { select: { id: true, poNumber: true } },
        items: {
          include: { product: true, warehouse: true, unit: true, tax: true },
        },
        // TASK-050 — Related Documents: Purchase Return(s) and Supplier
        // Payment(s) issued against this invoice, for the editor's
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
      throw new NotFoundException(`Purchase Invoice ${id} not found`);
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

  async update(id: string, dto: UpdatePurchaseInvoiceDto) {
    const existing = await this.findOne(id);
    if (existing.status !== PurchaseDocumentStatus.DRAFT) {
      throw new BadRequestException(
        'Only a Draft Purchase Invoice can be edited.',
      );
    }
    if (dto.supplierId) {
      await this.suppliersService.assertActiveSupplier(dto.supplierId);
    }

    let computed: ComputedInvoiceLines | undefined;
    if (dto.items) {
      for (const item of dto.items) {
        await this.assertActiveProduct(item.productId);
        await this.assertInvoiceWarehouse(item.warehouseId);
      }
      computed = await this.computeLines(dto.items);
    }

    return this.prisma.$transaction(async (tx) => {
      if (dto.items) {
        await tx.purchaseInvoiceItem.deleteMany({
          where: { purchaseInvoiceId: id },
        });
      }
      const invoice = await tx.purchaseInvoice.update({
        where: { id },
        data: {
          supplierId: dto.supplierId,
          currencyId: dto.currencyId,
          referenceNumber: dto.referenceNumber,
          internalNotes: dto.internalNotes,
          supplierNotes: dto.supplierNotes,
          ...(computed
            ? { ...computed.totals, items: { create: computed.lines } }
            : {}),
        },
        include: {
          supplier: true,
          currency: true,
          items: {
            include: { product: true, warehouse: true, unit: true, tax: true },
          },
        },
      });
      await this.activityService.log(
        id,
        PurchaseInvoiceActivityType.INVOICE_UPDATED,
        `Purchase Invoice ${invoice.invoiceNumber} updated`,
        undefined,
        tx,
      );
      return invoice;
    });
  }

  submit(id: string) {
    return this.transition(
      id,
      [PurchaseDocumentStatus.DRAFT],
      PurchaseDocumentStatus.PENDING_APPROVAL,
      PurchaseInvoiceActivityType.INVOICE_SUBMITTED,
      'submitted for approval',
    );
  }

  approve(id: string) {
    return this.transition(
      id,
      [PurchaseDocumentStatus.PENDING_APPROVAL],
      PurchaseDocumentStatus.APPROVED,
      PurchaseInvoiceActivityType.INVOICE_APPROVED,
      'approved',
    );
  }

  /** A Confirmed invoice is never cancelled directly — only reversed via a Purchase Return. */
  cancel(id: string, userId?: string) {
    return this.transition(
      id,
      [
        PurchaseDocumentStatus.DRAFT,
        PurchaseDocumentStatus.PENDING_APPROVAL,
        PurchaseDocumentStatus.APPROVED,
      ],
      PurchaseDocumentStatus.CANCELLED,
      PurchaseInvoiceActivityType.INVOICE_CANCELLED,
      'cancelled',
      { cancelledAt: new Date(), cancelledBy: userId ?? null },
    );
  }

  /**
   * Confirm = Goods Receipt: Increase Inventory. If this invoice came from
   * a Purchase Order, closes that PO in the same transaction — direct
   * Prisma write, no PurchaseOrdersModule dependency (that module already
   * depends on this one for "Convert to Invoice"; a circular Nest module
   * import is best avoided, same reasoning as
   * SalesInvoicesService.rollUpOrderDelivery).
   */
  /**
   * Receiving stock, updating moving-average cost, closing the source PO,
   * and posting the invoice all run inside ONE transaction (TASK-057) — a
   * failure partway through (e.g. a missing account mapping at posting time)
   * must never leave stock permanently received while the invoice stays
   * Approved, which would double-receive on a retry.
   */
  async confirm(id: string, userId?: string) {
    const invoice = await this.findOne(id);
    if (invoice.status !== PurchaseDocumentStatus.APPROVED) {
      throw new BadRequestException(
        `Cannot confirm Purchase Invoice ${invoice.invoiceNumber} from ${invoice.status}.`,
      );
    }

    return this.prisma.$transaction(async (tx) => {
      for (const item of invoice.items) {
        await this.inventoryService.postPurchaseReceipt(
          {
            productId: item.productId,
            warehouseId: item.warehouseId,
            quantity: item.quantity,
            unitCost: Number(item.unitPrice),
            referenceType: INVOICE_REFERENCE_TYPE,
            referenceId: invoice.id,
          },
          userId,
          tx,
        );
      }

      const updated = await tx.purchaseInvoice.update({
        where: { id },
        data: {
          status: PurchaseDocumentStatus.CONFIRMED,
          confirmedAt: new Date(),
          confirmedBy: userId ?? null,
        },
        include: {
          supplier: true,
          currency: true,
          items: {
            include: { product: true, warehouse: true, unit: true, tax: true },
          },
        },
      });
      await this.activityService.log(
        id,
        PurchaseInvoiceActivityType.INVOICE_CONFIRMED,
        `Purchase Invoice ${invoice.invoiceNumber} confirmed — inventory received`,
        undefined,
        tx,
      );

      if (invoice.purchaseOrderId) {
        await tx.purchaseOrder.update({
          where: { id: invoice.purchaseOrderId },
          data: { status: PurchaseOrderStatus.CLOSED },
        });
        await tx.purchaseOrderActivity.create({
          data: {
            purchaseOrderId: invoice.purchaseOrderId,
            type: PO_ACTIVITY_TYPE.PO_CLOSED,
            description: `Purchase Order closed — goods received via ${invoice.invoiceNumber}`,
            createdBy: userId ?? null,
          },
        });
      }

      await this.postingEngine.post('PURCHASE_INVOICE', id, userId, tx);

      return updated;
    });
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
    const archivableFrom: PurchaseDocumentStatus[] = [
      PurchaseDocumentStatus.DRAFT,
      PurchaseDocumentStatus.CANCELLED,
      PurchaseDocumentStatus.CONFIRMED,
      PurchaseDocumentStatus.CLOSED,
    ];
    if (!archivableFrom.includes(invoice.status)) {
      throw new BadRequestException(
        `Cannot archive Purchase Invoice ${invoice.invoiceNumber} while it is ${invoice.status}.`,
      );
    }
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.purchaseInvoice.update({
        where: { id },
        data: { deletedAt: new Date(), updatedBy: userId ?? null },
        include: {
          supplier: true,
          currency: true,
          items: {
            include: { product: true, warehouse: true, unit: true, tax: true },
          },
        },
      });
      await this.activityService.log(
        id,
        PurchaseInvoiceActivityType.INVOICE_ARCHIVED,
        `Purchase Invoice ${invoice.invoiceNumber} archived`,
        undefined,
        tx,
      );
      return updated;
    });
  }

  private async transition(
    id: string,
    allowedFrom: PurchaseDocumentStatus[],
    to: PurchaseDocumentStatus,
    activityType: string,
    verb: string,
    extraData: Prisma.PurchaseInvoiceUpdateInput = {},
  ) {
    const invoice = await this.findOne(id);
    if (!allowedFrom.includes(invoice.status)) {
      throw new BadRequestException(
        `Cannot transition Purchase Invoice ${invoice.invoiceNumber} from ${invoice.status} to ${to}.`,
      );
    }
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.purchaseInvoice.update({
        where: { id },
        data: { status: to, ...extraData },
        include: {
          supplier: true,
          currency: true,
          items: {
            include: { product: true, warehouse: true, unit: true, tax: true },
          },
        },
      });
      await this.activityService.log(
        id,
        activityType,
        `Purchase Invoice ${invoice.invoiceNumber} ${verb}`,
        undefined,
        tx,
      );
      return updated;
    });
  }

  private async createInvoice(
    header: {
      invoiceNumber: string;
      supplierId: string;
      purchaseOrderId: string | null;
      currencyId: string | null;
      companyId?: string | null;
      branchId?: string | null;
      costCenterId?: string | null;
      projectId?: string | null;
      referenceNumber: string | null;
      internalNotes: string | null;
      supplierNotes: string | null;
    },
    computed: ComputedInvoiceLines,
    activityType: string,
    describe: (invoice: { invoiceNumber: string }) => string,
    userId?: string,
  ) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const invoice = await tx.purchaseInvoice.create({
          data: {
            ...header,
            ...computed.totals,
            items: { create: computed.lines },
          },
          include: {
            supplier: true,
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
          'Invalid supplier, purchase order, currency, product, warehouse, unit, or tax reference.',
        );
      }
      throw error;
    }
  }

  private async assertActiveProduct(productId: string) {
    const product = await this.productsService.findOne(productId);
    if (product.status !== ProductStatus.ACTIVE) {
      throw new BadRequestException('Product is inactive.');
    }
    return product;
  }

  private async assertInvoiceWarehouse(warehouseId: string | undefined) {
    if (!warehouseId) {
      throw new BadRequestException(
        'Warehouse is required on every Purchase Invoice line.',
      );
    }
    const warehouse = await this.warehousesService.findOne(warehouseId);
    if (!warehouse.isActive) {
      throw new BadRequestException('Warehouse is inactive.');
    }
    return warehouse;
  }

  private async computeLines(
    items: PurchaseLineItemInputDto[],
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

    const lines: Prisma.PurchaseInvoiceItemUncheckedCreateWithoutPurchaseInvoiceInput[] =
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
