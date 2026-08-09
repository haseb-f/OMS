import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, ProductStatus, SalesDocumentStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { NumberingEngineService } from '../../numbering/numbering-engine.service';
import { ProductsService } from '../../products/products.service';
import { WarehousesService } from '../../warehouses/warehouses.service';
import { CustomersService } from '../../customers/customers.service';
import { InventoryService } from '../../inventory/inventory.service';
import { PostingEngineService } from '../../accounting/posting-engine/posting-engine.service';
import {
  SalesReturnActivityService,
  SalesReturnActivityType,
} from './activities/sales-return-activity.service';
import {
  computeSalesDocumentTotals,
  computeSalesLine,
} from '../shared/sales-totals.util';
import { buildDateRangeFilter } from '../shared/sales-list-query.util';
import { CreateSalesReturnDto } from './dto/create-sales-return.dto';
import { UpdateSalesReturnDto } from './dto/update-sales-return.dto';
import { FindSalesReturnsQueryDto } from './dto/find-sales-returns-query.dto';
import type { SalesLineItemInputDto } from '../shared/sales-line-item-input.dto';

const REFERENCE_TYPE = 'SALES_RETURN';

interface ComputedReturnLines {
  lines: Prisma.SalesReturnItemUncheckedCreateWithoutSalesReturnInput[];
  totals: ReturnType<typeof computeSalesDocumentTotals>;
}

@Injectable()
export class SalesReturnsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly customersService: CustomersService,
    private readonly productsService: ProductsService,
    private readonly warehousesService: WarehousesService,
    private readonly inventoryService: InventoryService,
    private readonly activityService: SalesReturnActivityService,
    private readonly numberingEngine: NumberingEngineService,
    private readonly postingEngine: PostingEngineService,
  ) {}

  async create(dto: CreateSalesReturnDto) {
    await this.customersService.assertActiveCustomer(dto.customerId);
    const sourceInvoice = await this.assertSourceInvoice(
      dto.salesInvoiceId,
      dto.customerId,
    );
    for (const item of dto.items) {
      await this.assertActiveProduct(item.productId);
      await this.assertReturnWarehouse(item.warehouseId);
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
    const computed = await this.computeLines(dto.items);
    const returnNumber =
      await this.numberingEngine.generateNumber('SALES_RETURN');

    try {
      return await this.prisma.$transaction(async (tx) => {
        const salesReturn = await tx.salesReturn.create({
          data: {
            returnNumber,
            customerId: dto.customerId,
            salesInvoiceId: dto.salesInvoiceId,
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
          include: {
            customer: true,
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
          'Invalid customer, invoice, currency, product, warehouse, unit, or tax reference.',
        );
      }
      throw error;
    }
  }

  async findAll(query: FindSalesReturnsQueryDto) {
    const where: Prisma.SalesReturnWhereInput = {
      deletedAt: null,
      customerId: query.customerId,
      status: query.status,
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
        include: { items: true, customer: true, currency: true },
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
        customer: true,
        currency: true,
        salesInvoice: { select: { invoiceNumber: true } },
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
    if (dto.customerId) {
      await this.customersService.assertActiveCustomer(dto.customerId);
    }

    let computed: ComputedReturnLines | undefined;
    if (dto.items) {
      const salesInvoiceId = dto.salesInvoiceId ?? existing.salesInvoiceId;
      if (!salesInvoiceId) {
        throw new BadRequestException(
          'This Sales Return has no source Sales Invoice — reference one before editing lines.',
        );
      }
      for (const item of dto.items) {
        await this.assertActiveProduct(item.productId);
        await this.assertReturnWarehouse(item.warehouseId);
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
      computed = await this.computeLines(dto.items);
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
          customerId: dto.customerId,
          salesInvoiceId: dto.salesInvoiceId,
          currencyId: dto.currencyId,
          referenceNumber: dto.referenceNumber,
          internalNotes: dto.internalNotes,
          customerNotes: dto.customerNotes,
          ...(computed
            ? { ...computed.totals, items: { create: computed.lines } }
            : {}),
        },
        include: {
          customer: true,
          currency: true,
          items: {
            include: { product: true, warehouse: true, unit: true, tax: true },
          },
        },
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

    return this.prisma.$transaction(async (tx) => {
      for (const item of salesReturn.items) {
        await this.inventoryService.postSalesReturn(
          {
            productId: item.productId,
            warehouseId: item.warehouseId,
            quantity: item.quantity,
            referenceType: REFERENCE_TYPE,
            referenceId: salesReturn.id,
          },
          userId,
          tx,
        );
      }

      const updated = await tx.salesReturn.update({
        where: { id },
        data: {
          status: SalesDocumentStatus.CONFIRMED,
          confirmedAt: new Date(),
          confirmedBy: userId ?? null,
        },
        include: {
          customer: true,
          currency: true,
          items: {
            include: { product: true, warehouse: true, unit: true, tax: true },
          },
        },
      });
      await this.activityService.log(
        id,
        SalesReturnActivityType.RETURN_CONFIRMED,
        `Sales Return ${salesReturn.returnNumber} confirmed — inventory increased`,
        undefined,
        tx,
      );
      await this.postingEngine.post('SALES_RETURN', id, userId, tx);
      return updated;
    });
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
        include: {
          customer: true,
          currency: true,
          items: {
            include: { product: true, warehouse: true, unit: true, tax: true },
          },
        },
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
        include: {
          customer: true,
          currency: true,
          items: {
            include: { product: true, warehouse: true, unit: true, tax: true },
          },
        },
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

  private async assertActiveProduct(productId: string) {
    const product = await this.productsService.findOne(productId);
    if (product.status !== ProductStatus.ACTIVE) {
      throw new BadRequestException('Product is inactive.');
    }
    return product;
  }

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
    return warehouse;
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

  /** TASK-048 — the return's customer must match its source invoice's customer; the invoice must exist and not be deleted. */
  private async assertSourceInvoice(
    salesInvoiceId: string,
    customerId: string,
  ) {
    const invoice = await this.prisma.salesInvoice.findFirst({
      where: { id: salesInvoiceId, deletedAt: null },
      select: {
        customerId: true,
        status: true,
        invoiceNumber: true,
        companyId: true,
        branchId: true,
        costCenterId: true,
        projectId: true,
      },
    });
    if (!invoice) {
      throw new NotFoundException(`Sales Invoice ${salesInvoiceId} not found`);
    }
    if (invoice.customerId !== customerId) {
      throw new BadRequestException(
        'Sales Return customer must match the source Sales Invoice customer.',
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
  ): Promise<ComputedReturnLines> {
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

    const lines: Prisma.SalesReturnItemUncheckedCreateWithoutSalesReturnInput[] =
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
        salesInvoiceItemId: item.salesInvoiceItemId,
        taxAmount: computedLines[index].taxAmount,
        lineTotal: computedLines[index].lineTotal,
        notes: item.notes,
      }));

    const totals = computeSalesDocumentTotals(computedLines);

    return { lines, totals };
  }
}
