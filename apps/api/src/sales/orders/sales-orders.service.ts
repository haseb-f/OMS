import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PartnerRoleType, Prisma, SalesDocumentStatus } from '@prisma/client';
import { PermissionsResolverService } from '../../permissions/permissions-resolver.service';
import { assertApprovalAuthority } from '../../common/workflow/approval-authority';
import {
  copySalesLines,
  DUPLICATED_FROM,
  RETURNED_TO_DRAFT,
} from '../../common/workflow/document-copy';
import { PrismaService } from '../../prisma/prisma.service';
import { NumberingEngineService } from '../../numbering/numbering-engine.service';
import { ProductsService } from '../../products/products.service';
import { WarehousesService } from '../../warehouses/warehouses.service';
import { PartnersService } from '../../partners/partners.service';
import { InventoryService } from '../../inventory/inventory.service';
import { resolveLineTaxes } from '../../taxes/document-tax';
import {
  SalesOrderDocumentActivityService,
  SalesOrderDocumentActivityType,
} from './activities/sales-order-document-activity.service';
import {
  computeSalesDocumentTotals,
  computeSalesLine,
} from '../shared/sales-totals.util';
import { buildDateRangeFilter } from '../shared/sales-list-query.util';
import type { CompanyContext } from '../../common/decorators/current-company-context.decorator';
import { CreateSalesOrderDto } from './dto/create-sales-order.dto';
import { UpdateSalesOrderDto } from './dto/update-sales-order.dto';
import { FindSalesOrdersQueryDto } from './dto/find-sales-orders-query.dto';
import { ConvertQuotationToOrderDto } from './dto/convert-quotation-to-order.dto';
import { ConvertOrderToInvoiceDto } from './dto/convert-order-to-invoice.dto';
import type { SalesLineItemInputDto } from '../shared/sales-line-item-input.dto';
import { SalesInvoicesService } from '../invoices/sales-invoices.service';
import { assertActiveProduct } from '../../products/assert-active-product.util';
import { prismaEnumFilter } from '../../common/query/enum-list';

const REFERENCE_TYPE = 'SALES_ORDER_DOC';

@Injectable()
export class SalesOrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly partnersService: PartnersService,
    private readonly productsService: ProductsService,
    private readonly warehousesService: WarehousesService,
    private readonly inventoryService: InventoryService,
    private readonly invoicesService: SalesInvoicesService,
    private readonly activityService: SalesOrderDocumentActivityService,
    private readonly numberingEngine: NumberingEngineService,
    private readonly permissions: PermissionsResolverService,
  ) {}

  async create(
    dto: CreateSalesOrderDto,
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
      await this.assertOrderWarehouse(item.warehouseId);
    }
    const computed = await this.computeLines(dto.items);
    const orderNumber =
      await this.numberingEngine.generateNumber('SALES_ORDER_DOC');

    return this.createOrder(
      {
        orderNumber,
        partnerId: dto.partnerId,
        currencyId: dto.currencyId ?? null,
        companyId: context.companyId,
        branchId: context.branchId,
        referenceNumber: dto.referenceNumber ?? null,
        internalNotes: dto.internalNotes ?? null,
        customerNotes: dto.customerNotes ?? null,
        quotationId: null,
      },
      computed,
      SalesOrderDocumentActivityType.ORDER_CREATED,
      (order) => `Sales Order ${order.orderNumber} created`,
    );
  }

  /**
   * Reads the Quotation directly via Prisma (no dependency on
   * SalesQuotationsModule — that module already depends on this one for the
   * reverse direction, and Nest circular module imports are best avoided).
   * A Quotation line never carries a Warehouse (optional there — a quote
   * commits nothing), so the caller must supply one per line here;
   * `quantity` is an optional override, defaulting to the quotation's own.
   */
  async createFromQuotation(
    quotationId: string,
    dto: ConvertQuotationToOrderDto,
    userId?: string,
  ) {
    const quotation = await this.prisma.salesQuotation.findFirst({
      where: { id: quotationId, deletedAt: null },
      include: { items: true },
    });
    if (!quotation) {
      throw new NotFoundException(`Quotation ${quotationId} not found`);
    }
    if (quotation.status === SalesDocumentStatus.CLOSED) {
      // Retry after a reload/timeout — open the order already created.
      const existing = await this.prisma.salesOrderDocument.findFirst({
        where: { quotationId, deletedAt: null },
        orderBy: { createdAt: 'desc' },
        select: { id: true },
      });
      if (existing) return this.findOne(existing.id);
    }
    if (quotation.status !== SalesDocumentStatus.APPROVED) {
      throw new BadRequestException(
        `Cannot convert Quotation ${quotation.quotationNumber} to a Sales Order unless it is Approved.`,
      );
    }
    await this.partnersService.assertActiveForRole(
      quotation.partnerId,
      PartnerRoleType.CUSTOMER,
    );

    const quotationItemById = new Map(
      quotation.items.map((item) => [item.id, item]),
    );
    const productsById = await this.productsService.findManyForValidation(
      quotation.items.map((item) => item.productId),
    );
    const items: SalesLineItemInputDto[] = [];
    for (const line of dto.items) {
      const quotationItem = quotationItemById.get(line.quotationItemId);
      if (!quotationItem) {
        throw new BadRequestException(
          `Quotation item ${line.quotationItemId} does not belong to this Quotation.`,
        );
      }
      assertActiveProduct(quotationItem.productId, productsById);
      await this.assertOrderWarehouse(line.warehouseId);
      items.push({
        productId: quotationItem.productId,
        description: quotationItem.description ?? undefined,
        warehouseId: line.warehouseId,
        unitId: quotationItem.unitId,
        quantity: line.quantity ?? quotationItem.quantity,
        unitPrice: Number(quotationItem.unitPrice),
        discountPercent: Number(quotationItem.discountPercent),
        discountValue: Number(quotationItem.discountValue),
        taxId: quotationItem.taxId ?? undefined,
        notes: quotationItem.notes ?? undefined,
      });
    }

    const computed = await this.computeLines(items);
    const orderNumber =
      await this.numberingEngine.generateNumber('SALES_ORDER_DOC');

    return this.createOrder(
      {
        orderNumber,
        partnerId: quotation.partnerId,
        currencyId: quotation.currencyId,
        companyId: quotation.companyId,
        branchId: quotation.branchId,
        referenceNumber: quotation.referenceNumber,
        internalNotes: quotation.internalNotes,
        customerNotes: quotation.customerNotes,
        quotationId: quotation.id,
      },
      computed,
      SalesOrderDocumentActivityType.ORDER_CREATED_FROM_QUOTATION,
      (order) =>
        `Sales Order ${order.orderNumber} created from Quotation ${quotation.quotationNumber}`,
      async (tx) => {
        await tx.salesQuotation.update({
          where: { id: quotation.id },
          data: { status: SalesDocumentStatus.CLOSED },
        });
        await tx.salesQuotationActivity.create({
          data: {
            salesQuotationId: quotation.id,
            type: 'QUOTATION_CONVERTED_TO_ORDER',
            description: `Converted to Sales Order ${orderNumber}`,
            createdBy: userId ?? null,
          },
        });
      },
    );
  }

  private buildFindWhere(
    query: Pick<
      FindSalesOrdersQueryDto,
      'partnerId' | 'status' | 'search' | 'dateFrom' | 'dateTo'
    >,
  ): Prisma.SalesOrderDocumentWhereInput {
    const where: Prisma.SalesOrderDocumentWhereInput = {
      deletedAt: null,
      partnerId: prismaEnumFilter(query.partnerId),
      status: prismaEnumFilter(query.status),
    };
    if (query.search) {
      where.OR = [
        { orderNumber: { contains: query.search, mode: 'insensitive' } },
        { referenceNumber: { contains: query.search, mode: 'insensitive' } },
      ];
    }
    if (query.dateFrom || query.dateTo) {
      where.createdAt = buildDateRangeFilter(query.dateFrom, query.dateTo);
    }
    return where;
  }

  async findAll(query: FindSalesOrdersQueryDto) {
    const where = this.buildFindWhere(query);
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const [items, total] = await Promise.all([
      this.prisma.salesOrderDocument.findMany({
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
      this.prisma.salesOrderDocument.count({ where }),
    ]);

    return { items, total, page, pageSize };
  }

  /** "Select all matching filters" (Part 8) — bare IDs only, same filter/search as `findAll`, capped so the response never approaches "download the dataset." */
  async findAllIds(query: FindSalesOrdersQueryDto) {
    const where = this.buildFindWhere(query);
    const [rows, total] = await Promise.all([
      this.prisma.salesOrderDocument.findMany({
        where,
        select: { id: true },
        take: 10_000,
      }),
      this.prisma.salesOrderDocument.count({ where }),
    ]);
    return { ids: rows.map((row) => row.id), total };
  }

  /** Bulk Archive — sequential loop over the existing single-row `archive()` (which already enforces the archivable-status rule), same partial-failure pattern used elsewhere in the API. */
  async archiveMany(ids: string[], userId?: string) {
    const succeeded: string[] = [];
    const failed: { id: string; message: string }[] = [];
    for (const id of ids) {
      try {
        await this.archive(id, userId);
        succeeded.push(id);
      } catch (error) {
        failed.push({
          id,
          message:
            error instanceof Error ? error.message : 'Failed to archive.',
        });
      }
    }
    return { succeeded, failed };
  }

  async findOne(id: string) {
    const order = await this.prisma.salesOrderDocument.findFirst({
      where: { id, deletedAt: null },
      include: {
        partner: true,
        currency: true,
        quotation: { select: { quotationNumber: true } },
        items: {
          include: { product: true, warehouse: true, unit: true, tax: true },
        },
        // TASK-050 — Related Documents: Sales Invoice(s) converted from
        // this order, for the editor's reference-links section.
        invoices: {
          where: { deletedAt: null },
          select: { id: true, invoiceNumber: true, status: true },
        },
      },
    });
    if (!order) {
      throw new NotFoundException(`Sales Order ${id} not found`);
    }
    return order;
  }

  async update(id: string, dto: UpdateSalesOrderDto) {
    const existing = await this.findOne(id);
    if (existing.status !== SalesDocumentStatus.DRAFT) {
      throw new BadRequestException('Only a Draft Sales Order can be edited.');
    }
    if (dto.partnerId) {
      await this.partnersService.assertActiveForRole(
        dto.partnerId,
        PartnerRoleType.CUSTOMER,
      );
    }

    let computed: Awaited<ReturnType<typeof this.computeLines>> | undefined;
    if (dto.items) {
      const productsById = await this.productsService.findManyForValidation(
        dto.items.map((item) => item.productId),
      );
      for (const item of dto.items) {
        assertActiveProduct(item.productId, productsById);
        await this.assertOrderWarehouse(item.warehouseId);
      }
      computed = await this.computeLines(dto.items);
    }

    return this.prisma.$transaction(async (tx) => {
      if (dto.items) {
        await tx.salesOrderDocumentItem.deleteMany({
          where: { salesOrderId: id },
        });
      }
      const order = await tx.salesOrderDocument.update({
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
        SalesOrderDocumentActivityType.ORDER_UPDATED,
        `Sales Order ${order.orderNumber} updated`,
        undefined,
        tx,
      );
      return order;
    });
  }

  submit(id: string) {
    return this.transition(
      id,
      [SalesDocumentStatus.DRAFT],
      SalesDocumentStatus.PENDING_APPROVAL,
      SalesOrderDocumentActivityType.ORDER_SUBMITTED,
      'submitted for approval',
    );
  }

  approve(id: string) {
    return this.transition(
      id,
      [SalesDocumentStatus.PENDING_APPROVAL],
      SalesDocumentStatus.APPROVED,
      SalesOrderDocumentActivityType.ORDER_APPROVED,
      'approved',
    );
  }

  /** Confirm = Reserve Inventory, in ONE transaction with the status flip —
   * a failed line rolls every reservation back, so a retry can never
   * double-reserve. From Draft/Pending Approval it is the single "Confirm
   * order" action: allowed only for users who hold the approval permission,
   * and the implicit approval is recorded in the activity log. */
  async confirm(id: string, userId?: string) {
    const order = await this.findOne(id);
    if (order.status === SalesDocumentStatus.CONFIRMED) return order;
    const confirmableFrom: SalesDocumentStatus[] = [
      SalesDocumentStatus.DRAFT,
      SalesDocumentStatus.PENDING_APPROVAL,
      SalesDocumentStatus.APPROVED,
    ];
    if (!confirmableFrom.includes(order.status)) {
      throw new BadRequestException(
        `Cannot confirm Sales Order ${order.orderNumber} from ${order.status}.`,
      );
    }
    const implicitApproval = order.status !== SalesDocumentStatus.APPROVED;
    if (implicitApproval) {
      await assertApprovalAuthority(
        this.permissions,
        userId,
        'sales.orders.approve',
        `Sales Order ${order.orderNumber}`,
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const locked = await tx.salesOrderDocument.updateMany({
        where: { id, status: order.status },
        data: { status: SalesDocumentStatus.CONFIRMED },
      });
      if (locked.count === 0) {
        throw new BadRequestException(
          `Sales Order ${order.orderNumber} was changed by someone else — reload and try again.`,
        );
      }
      for (const item of order.items) {
        if (!item.product.isInventoryItem) continue;
        await this.inventoryService.reserve(
          {
            productId: item.productId,
            warehouseId: item.warehouseId,
            quantity: item.quantity,
            referenceType: REFERENCE_TYPE,
            referenceId: order.id,
          },
          userId,
          tx,
        );
      }
      const updated = await tx.salesOrderDocument.update({
        where: { id },
        data: {
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
      if (implicitApproval) {
        await this.activityService.log(
          id,
          SalesOrderDocumentActivityType.ORDER_APPROVED,
          `Sales Order ${order.orderNumber} approved`,
          undefined,
          tx,
        );
      }
      await this.activityService.log(
        id,
        SalesOrderDocumentActivityType.ORDER_CONFIRMED,
        `Sales Order ${order.orderNumber} confirmed — inventory reserved`,
        undefined,
        tx,
      );
      return updated;
    });
  }

  /** Releases whatever's still reserved (ordered minus already-delivered per line) before cancelling. */
  async cancel(id: string, userId?: string) {
    const order = await this.findOne(id);
    const cancellableFrom: SalesDocumentStatus[] = [
      SalesDocumentStatus.DRAFT,
      SalesDocumentStatus.PENDING_APPROVAL,
      SalesDocumentStatus.APPROVED,
      SalesDocumentStatus.CONFIRMED,
    ];
    if (!cancellableFrom.includes(order.status)) {
      throw new BadRequestException(
        `Cannot cancel Sales Order ${order.orderNumber} from ${order.status}.`,
      );
    }

    if (order.status === SalesDocumentStatus.CONFIRMED) {
      for (const item of order.items) {
        const remaining = item.quantity - item.deliveredQuantity;
        if (remaining > 0 && item.product.isInventoryItem) {
          await this.inventoryService.release(
            {
              productId: item.productId,
              warehouseId: item.warehouseId,
              quantity: remaining,
              referenceType: REFERENCE_TYPE,
              referenceId: order.id,
            },
            userId,
          );
        }
      }
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.salesOrderDocument.update({
        where: { id },
        data: {
          status: SalesDocumentStatus.CANCELLED,
          cancelledAt: new Date(),
          cancelledBy: userId ?? null,
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
        SalesOrderDocumentActivityType.ORDER_CANCELLED,
        `Sales Order ${order.orderNumber} cancelled`,
        undefined,
        tx,
      );
      return updated;
    });
  }

  /**
   * Soft-delete — hides the order from findAll/findOne without destroying
   * data, mirroring the "Archive is soft-delete" pattern already used for
   * Product/Supplier. Allowed once the order is no longer actively
   * progressing: Draft/Cancelled/Closed, or Delivered (its own completion
   * state, same role Closed plays for the other three documents).
   */
  async archive(id: string, userId?: string) {
    const order = await this.findOne(id);
    const archivableFrom: SalesDocumentStatus[] = [
      SalesDocumentStatus.DRAFT,
      SalesDocumentStatus.CANCELLED,
      SalesDocumentStatus.DELIVERED,
      SalesDocumentStatus.CLOSED,
    ];
    if (!archivableFrom.includes(order.status)) {
      throw new BadRequestException(
        `Cannot archive Sales Order ${order.orderNumber} while it is ${order.status}.`,
      );
    }
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.salesOrderDocument.update({
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
        SalesOrderDocumentActivityType.ORDER_ARCHIVED,
        `Sales Order ${order.orderNumber} archived`,
        undefined,
        tx,
      );
      return updated;
    });
  }

  /** Order → Invoice, partial-quantity aware — delegates the actual Invoice
   * creation to SalesInvoicesService.createFromOrder. */
  async convertToInvoice(
    id: string,
    dto: ConvertOrderToInvoiceDto,
    userId?: string,
  ) {
    const order = await this.findOne(id);
    if (
      order.status !== SalesDocumentStatus.CONFIRMED &&
      order.status !== SalesDocumentStatus.PARTIALLY_DELIVERED
    ) {
      throw new BadRequestException(
        `Cannot invoice Sales Order ${order.orderNumber} from ${order.status}.`,
      );
    }

    const itemById = new Map(order.items.map((item) => [item.id, item]));
    // Quantities already on an open (not yet posted) invoice count as billed:
    // converting twice must reopen that draft, never bill the lines again.
    const openInvoiceLines = await this.prisma.salesInvoiceItem.groupBy({
      by: ['salesOrderItemId'],
      where: {
        salesOrderItemId: { in: order.items.map((item) => item.id) },
        salesInvoice: {
          deletedAt: null,
          status: {
            in: [
              SalesDocumentStatus.DRAFT,
              SalesDocumentStatus.PENDING_APPROVAL,
              SalesDocumentStatus.APPROVED,
            ],
          },
        },
      },
      _sum: { quantity: true },
    });
    const pendingByItem = new Map(
      openInvoiceLines.map((row) => [
        row.salesOrderItemId,
        Number(row._sum.quantity ?? 0),
      ]),
    );
    const lines = dto.items.map((line) => {
      const orderItem = itemById.get(line.salesOrderItemId);
      if (!orderItem) {
        throw new BadRequestException(
          `Order item ${line.salesOrderItemId} does not belong to this Sales Order.`,
        );
      }
      const remaining =
        orderItem.quantity -
        orderItem.deliveredQuantity -
        (pendingByItem.get(orderItem.id) ?? 0);
      return { orderItem, quantity: line.quantity, remaining };
    });
    if (lines.every((line) => line.remaining <= 0)) {
      const draft = await this.prisma.salesInvoice.findFirst({
        where: {
          salesOrderId: id,
          deletedAt: null,
          status: {
            in: [
              SalesDocumentStatus.DRAFT,
              SalesDocumentStatus.PENDING_APPROVAL,
              SalesDocumentStatus.APPROVED,
            ],
          },
        },
        orderBy: { createdAt: 'desc' },
        select: { id: true },
      });
      if (draft) return this.invoicesService.findOne(draft.id);
    }
    for (const line of lines) {
      if (line.quantity > line.remaining) {
        throw new BadRequestException(
          `Cannot invoice ${line.quantity} of ${line.orderItem.productId} — only ${Math.max(line.remaining, 0)} remains uninvoiced.`,
        );
      }
    }

    return this.invoicesService.createFromOrder(order, lines, userId);
  }

  async duplicate(id: string, userId?: string) {
    const source = await this.findOne(id);
    const copy = await this.create(
      {
        partnerId: source.partnerId,
        currencyId: source.currencyId ?? undefined,
        referenceNumber: source.referenceNumber ?? undefined,
        internalNotes: source.internalNotes ?? undefined,
        customerNotes: source.customerNotes ?? undefined,
        items: copySalesLines(source.items),
      },
      { companyId: source.companyId, branchId: source.branchId },
    );
    await this.activityService.log(
      copy.id,
      DUPLICATED_FROM,
      `Sales Order ${copy.orderNumber} duplicated from ${source.orderNumber}`,
      { sourceId: id, userId },
    );
    return copy;
  }

  /** Back to Draft. A Confirmed order qualifies only while nothing has been
   *  invoiced or delivered; its reservations are released in the same
   *  transaction (the reservation history stays in the stock ledger). */
  async returnToDraft(id: string, userId?: string) {
    const order = await this.findOne(id);
    const allowed: SalesDocumentStatus[] = [
      SalesDocumentStatus.PENDING_APPROVAL,
      SalesDocumentStatus.APPROVED,
      SalesDocumentStatus.CONFIRMED,
      SalesDocumentStatus.CANCELLED,
    ];
    if (!allowed.includes(order.status)) {
      throw new BadRequestException(
        `Cannot return Sales Order ${order.orderNumber} to Draft from ${order.status}.`,
      );
    }
    if (order.status === SalesDocumentStatus.CONFIRMED) {
      const invoiced = await this.prisma.salesInvoice.count({
        where: {
          salesOrderId: id,
          deletedAt: null,
          status: { not: SalesDocumentStatus.CANCELLED },
        },
      });
      if (
        invoiced > 0 ||
        order.items.some((item) => item.deliveredQuantity > 0)
      ) {
        throw new BadRequestException(
          `Sales Order ${order.orderNumber} already has invoices or deliveries — it can no longer return to Draft.`,
        );
      }
    }
    return this.prisma.$transaction(async (tx) => {
      const claimed = await tx.salesOrderDocument.updateMany({
        where: { id, status: order.status },
        data: {
          status: SalesDocumentStatus.DRAFT,
          confirmedAt: null,
          confirmedBy: null,
          cancelledAt: null,
          cancelledBy: null,
          updatedBy: userId ?? null,
        },
      });
      if (claimed.count === 0) {
        throw new BadRequestException(
          `Sales Order ${order.orderNumber} was changed by someone else — reload and try again.`,
        );
      }
      if (order.status === SalesDocumentStatus.CONFIRMED) {
        for (const item of order.items) {
          if (!item.product.isInventoryItem) continue;
          await this.inventoryService.release(
            {
              productId: item.productId,
              warehouseId: item.warehouseId,
              quantity: item.quantity,
              referenceType: REFERENCE_TYPE,
              referenceId: order.id,
            },
            userId,
            tx,
          );
        }
      }
      await this.activityService.log(
        id,
        RETURNED_TO_DRAFT,
        `Sales Order ${order.orderNumber} returned to draft`,
        undefined,
        tx,
      );
      return tx.salesOrderDocument.findUniqueOrThrow({
        where: { id },
        include: {
          partner: true,
          currency: true,
          items: {
            include: { product: true, warehouse: true, unit: true, tax: true },
          },
        },
      });
    });
  }

  private async transition(
    id: string,
    allowedFrom: SalesDocumentStatus[],
    to: SalesDocumentStatus,
    activityType: string,
    verb: string,
  ) {
    const order = await this.findOne(id);
    if (!allowedFrom.includes(order.status)) {
      throw new BadRequestException(
        `Cannot transition Sales Order ${order.orderNumber} from ${order.status} to ${to}.`,
      );
    }
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.salesOrderDocument.update({
        where: { id },
        data: { status: to },
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
        `Sales Order ${order.orderNumber} ${verb}`,
        undefined,
        tx,
      );
      return updated;
    });
  }

  private async createOrder(
    header: {
      orderNumber: string;
      partnerId: string;
      currencyId: string | null;
      companyId?: string | null;
      branchId?: string | null;
      referenceNumber: string | null;
      internalNotes: string | null;
      customerNotes: string | null;
      quotationId: string | null;
    },
    computed: Awaited<ReturnType<typeof this.computeLines>>,
    activityType: string,
    describe: (order: { orderNumber: string }) => string,
    beforeCommit?: (tx: Prisma.TransactionClient) => Promise<void>,
  ) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const order = await tx.salesOrderDocument.create({
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
        if (beforeCommit) {
          await beforeCommit(tx);
        }
        await this.activityService.log(
          order.id,
          activityType,
          describe(order),
          undefined,
          tx,
        );
        return order;
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

  private async assertOrderWarehouse(warehouseId: string | undefined) {
    if (!warehouseId) {
      throw new BadRequestException(
        'Warehouse is required on every Sales Order line.',
      );
    }
    const warehouse = await this.warehousesService.findOne(warehouseId);
    if (!warehouse.isActive) {
      throw new BadRequestException('Warehouse is inactive.');
    }
    return warehouse;
  }

  private async computeLines(items: SalesLineItemInputDto[]) {
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

    const lines = items.map((item, index) => ({
      productId: item.productId,
      description: item.description,
      warehouseId: item.warehouseId as string,
      unitId: item.unitId,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      discountPercent: item.discountPercent ?? 0,
      discountValue: item.discountValue ?? 0,
      taxId: taxIds[index],
      taxAmount: computedLines[index].taxAmount,
      lineTotal: computedLines[index].lineTotal,
      notes: item.notes,
    }));

    const totals = computeSalesDocumentTotals(computedLines);

    return { lines, totals };
  }
}
