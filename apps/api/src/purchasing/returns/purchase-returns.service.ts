import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, ProductStatus, PurchaseDocumentStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { NumberingEngineService } from '../../numbering/numbering-engine.service';
import { ProductsService } from '../../products/products.service';
import { WarehousesService } from '../../warehouses/warehouses.service';
import { SuppliersService } from '../../suppliers/suppliers.service';
import { InventoryService } from '../../inventory/inventory.service';
import { PostingEngineService } from '../../accounting/posting-engine/posting-engine.service';
import {
  PurchaseReturnActivityService,
  PurchaseReturnActivityType,
} from './activities/purchase-return-activity.service';
import {
  computeSalesDocumentTotals,
  computeSalesLine,
} from '../../sales/shared/sales-totals.util';
import { buildDateRangeFilter } from '../../sales/shared/sales-list-query.util';
import { CreatePurchaseReturnDto } from './dto/create-purchase-return.dto';
import { UpdatePurchaseReturnDto } from './dto/update-purchase-return.dto';
import { FindPurchaseReturnsQueryDto } from './dto/find-purchase-returns-query.dto';
import type { PurchaseLineItemInputDto } from '../shared/purchase-line-item-input.dto';

const REFERENCE_TYPE = 'PURCHASE_RETURN';

interface ComputedReturnLines {
  lines: Prisma.PurchaseReturnItemUncheckedCreateWithoutPurchaseReturnInput[];
  totals: ReturnType<typeof computeSalesDocumentTotals>;
}

@Injectable()
export class PurchaseReturnsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly suppliersService: SuppliersService,
    private readonly productsService: ProductsService,
    private readonly warehousesService: WarehousesService,
    private readonly inventoryService: InventoryService,
    private readonly activityService: PurchaseReturnActivityService,
    private readonly numberingEngine: NumberingEngineService,
    private readonly postingEngine: PostingEngineService,
  ) {}

  async create(dto: CreatePurchaseReturnDto) {
    await this.suppliersService.assertActiveSupplier(dto.supplierId);
    const sourceInvoice = await this.assertSourceInvoice(
      dto.purchaseInvoiceId,
      dto.supplierId,
    );
    for (const item of dto.items) {
      await this.assertActiveProduct(item.productId);
      await this.assertReturnWarehouse(item.warehouseId);
      if (!item.purchaseInvoiceItemId) {
        throw new BadRequestException(
          'Every Purchase Return line must reference a Purchase Invoice line — a return cannot be created without a source invoice.',
        );
      }
      await this.assertReturnableQuantity(
        dto.purchaseInvoiceId,
        item.purchaseInvoiceItemId,
        item.quantity,
      );
    }
    const computed = await this.computeLines(dto.items);
    const returnNumber =
      await this.numberingEngine.generateNumber('PURCHASE_RETURN');

    try {
      return await this.prisma.$transaction(async (tx) => {
        const purchaseReturn = await tx.purchaseReturn.create({
          data: {
            returnNumber,
            supplierId: dto.supplierId,
            purchaseInvoiceId: dto.purchaseInvoiceId,
            currencyId: dto.currencyId,
            // TASK-051 Document Context Enrichment — inherited from the source invoice, never re-selected on the return.
            companyId: sourceInvoice.companyId,
            branchId: sourceInvoice.branchId,
            costCenterId: sourceInvoice.costCenterId,
            projectId: sourceInvoice.projectId,
            referenceNumber: dto.referenceNumber,
            internalNotes: dto.internalNotes,
            supplierNotes: dto.supplierNotes,
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
          purchaseReturn.id,
          PurchaseReturnActivityType.RETURN_CREATED,
          `Purchase Return ${purchaseReturn.returnNumber} created`,
          undefined,
          tx,
        );
        return purchaseReturn;
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2003'
      ) {
        throw new BadRequestException(
          'Invalid supplier, invoice, currency, product, warehouse, unit, or tax reference.',
        );
      }
      throw error;
    }
  }

  async findAll(query: FindPurchaseReturnsQueryDto) {
    const where: Prisma.PurchaseReturnWhereInput = {
      deletedAt: null,
      supplierId: query.supplierId,
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
      this.prisma.purchaseReturn.findMany({
        where,
        include: { items: true, supplier: true, currency: true },
        orderBy: { [query.sortBy || 'createdAt']: query.sortOrder ?? 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.purchaseReturn.count({ where }),
    ]);

    return { items, total, page, pageSize };
  }

  async findOne(id: string) {
    const purchaseReturn = await this.prisma.purchaseReturn.findFirst({
      where: { id, deletedAt: null },
      include: {
        supplier: true,
        currency: true,
        purchaseInvoice: { select: { invoiceNumber: true } },
        items: {
          include: { product: true, warehouse: true, unit: true, tax: true },
        },
      },
    });
    if (!purchaseReturn) {
      throw new NotFoundException(`Purchase Return ${id} not found`);
    }
    return purchaseReturn;
  }

  /**
   * TASK-048 — read-only: per-line invoiced/already-returned/remaining
   * quantities for a Purchase Invoice, so the "Create Return" flow can
   * display already-returned quantities and cap the requested quantity at
   * what's actually still returnable. Mirrors `assertReturnableQuantity`'s
   * own math exactly.
   */
  async returnableSummary(purchaseInvoiceId: string) {
    const invoice = await this.prisma.purchaseInvoice.findFirst({
      where: { id: purchaseInvoiceId, deletedAt: null },
      include: { items: true },
    });
    if (!invoice) {
      throw new NotFoundException(
        `Purchase Invoice ${purchaseInvoiceId} not found`,
      );
    }

    const returned = await this.prisma.purchaseReturnItem.groupBy({
      by: ['purchaseInvoiceItemId'],
      where: {
        purchaseInvoiceItemId: { in: invoice.items.map((item) => item.id) },
        purchaseReturn: { status: { not: PurchaseDocumentStatus.CANCELLED } },
      },
      _sum: { quantity: true },
    });
    const returnedById = new Map(
      returned.map((row) => [
        row.purchaseInvoiceItemId,
        row._sum.quantity ?? 0,
      ]),
    );

    return {
      items: invoice.items.map((item) => {
        const returnedQuantity = returnedById.get(item.id) ?? 0;
        return {
          purchaseInvoiceItemId: item.id,
          invoicedQuantity: item.quantity,
          returnedQuantity,
          remainingQuantity: item.quantity - returnedQuantity,
        };
      }),
    };
  }

  async update(id: string, dto: UpdatePurchaseReturnDto) {
    const existing = await this.findOne(id);
    if (existing.status !== PurchaseDocumentStatus.DRAFT) {
      throw new BadRequestException('Only a Draft return can be edited.');
    }
    if (dto.supplierId) {
      await this.suppliersService.assertActiveSupplier(dto.supplierId);
    }

    let computed: ComputedReturnLines | undefined;
    if (dto.items) {
      const purchaseInvoiceId =
        dto.purchaseInvoiceId ?? existing.purchaseInvoiceId;
      if (!purchaseInvoiceId) {
        throw new BadRequestException(
          'This Purchase Return has no source Purchase Invoice — reference one before editing lines.',
        );
      }
      for (const item of dto.items) {
        await this.assertActiveProduct(item.productId);
        await this.assertReturnWarehouse(item.warehouseId);
        if (!item.purchaseInvoiceItemId) {
          throw new BadRequestException(
            'Every Purchase Return line must reference a Purchase Invoice line — a return cannot be created without a source invoice.',
          );
        }
        await this.assertReturnableQuantity(
          purchaseInvoiceId,
          item.purchaseInvoiceItemId,
          item.quantity,
          id,
        );
      }
      computed = await this.computeLines(dto.items);
    }

    return this.prisma.$transaction(async (tx) => {
      if (dto.items) {
        await tx.purchaseReturnItem.deleteMany({
          where: { purchaseReturnId: id },
        });
      }
      const purchaseReturn = await tx.purchaseReturn.update({
        where: { id },
        data: {
          supplierId: dto.supplierId,
          purchaseInvoiceId: dto.purchaseInvoiceId,
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
        PurchaseReturnActivityType.RETURN_UPDATED,
        `Purchase Return ${purchaseReturn.returnNumber} updated`,
        undefined,
        tx,
      );
      return purchaseReturn;
    });
  }

  submit(id: string) {
    return this.transition(
      id,
      [PurchaseDocumentStatus.DRAFT],
      PurchaseDocumentStatus.PENDING_APPROVAL,
      PurchaseReturnActivityType.RETURN_SUBMITTED,
      'submitted for approval',
    );
  }

  approve(id: string) {
    return this.transition(
      id,
      [PurchaseDocumentStatus.PENDING_APPROVAL],
      PurchaseDocumentStatus.APPROVED,
      PurchaseReturnActivityType.RETURN_APPROVED,
      'approved',
    );
  }

  cancel(id: string, userId?: string) {
    return this.transition(
      id,
      [
        PurchaseDocumentStatus.DRAFT,
        PurchaseDocumentStatus.PENDING_APPROVAL,
        PurchaseDocumentStatus.APPROVED,
      ],
      PurchaseDocumentStatus.CANCELLED,
      PurchaseReturnActivityType.RETURN_CANCELLED,
      'cancelled',
      { cancelledAt: new Date(), cancelledBy: userId ?? null },
    );
  }

  /** Confirm = Decrease Inventory — goods going back to the Supplier. */
  /** Decreasing stock and posting the return run inside ONE transaction (TASK-057) — same atomicity reasoning as PurchaseInvoicesService.confirm. */
  async confirm(id: string, userId?: string) {
    const purchaseReturn = await this.findOne(id);
    if (purchaseReturn.status !== PurchaseDocumentStatus.APPROVED) {
      throw new BadRequestException(
        `Cannot confirm Purchase Return ${purchaseReturn.returnNumber} from ${purchaseReturn.status}.`,
      );
    }

    return this.prisma.$transaction(async (tx) => {
      for (const item of purchaseReturn.items) {
        await this.inventoryService.postPurchaseReturn(
          {
            productId: item.productId,
            warehouseId: item.warehouseId,
            quantity: item.quantity,
            referenceType: REFERENCE_TYPE,
            referenceId: purchaseReturn.id,
          },
          userId,
          tx,
        );
      }

      const updated = await tx.purchaseReturn.update({
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
        PurchaseReturnActivityType.RETURN_CONFIRMED,
        `Purchase Return ${purchaseReturn.returnNumber} confirmed — inventory decreased`,
        undefined,
        tx,
      );
      await this.postingEngine.post('PURCHASE_RETURN', id, userId, tx);
      return updated;
    });
  }

  /**
   * Soft-delete — hides the return from findAll/findOne without destroying
   * data, mirroring the "Archive is soft-delete" pattern already used for
   * Product/Supplier. Allowed once the return is no longer actively
   * progressing: Draft/Cancelled/Closed, or Confirmed — a confirmed return
   * has already posted its inventory decrease and is effectively final.
   */
  async archive(id: string, userId?: string) {
    const purchaseReturn = await this.findOne(id);
    const archivableFrom: PurchaseDocumentStatus[] = [
      PurchaseDocumentStatus.DRAFT,
      PurchaseDocumentStatus.CANCELLED,
      PurchaseDocumentStatus.CONFIRMED,
      PurchaseDocumentStatus.CLOSED,
    ];
    if (!archivableFrom.includes(purchaseReturn.status)) {
      throw new BadRequestException(
        `Cannot archive Purchase Return ${purchaseReturn.returnNumber} while it is ${purchaseReturn.status}.`,
      );
    }
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.purchaseReturn.update({
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
        PurchaseReturnActivityType.RETURN_ARCHIVED,
        `Purchase Return ${purchaseReturn.returnNumber} archived`,
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
    extraData: Prisma.PurchaseReturnUpdateInput = {},
  ) {
    const purchaseReturn = await this.findOne(id);
    if (!allowedFrom.includes(purchaseReturn.status)) {
      throw new BadRequestException(
        `Cannot transition Purchase Return ${purchaseReturn.returnNumber} from ${purchaseReturn.status} to ${to}.`,
      );
    }
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.purchaseReturn.update({
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
        `Purchase Return ${purchaseReturn.returnNumber} ${verb}`,
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
        'Warehouse is required on every Purchase Return line.',
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
   * Purchase Invoice, then caps returned quantity at received quantity
   * minus already-returned (across non-cancelled returns).
   * `excludeReturnId` omits the return being edited from the "already
   * returned" sum — otherwise re-saving an existing return's own unchanged
   * lines would double-count itself.
   */
  private async assertReturnableQuantity(
    purchaseInvoiceId: string,
    purchaseInvoiceItemId: string,
    quantity: number,
    excludeReturnId?: string,
  ) {
    const invoiceItem = await this.prisma.purchaseInvoiceItem.findUnique({
      where: { id: purchaseInvoiceItemId },
    });
    if (!invoiceItem || invoiceItem.purchaseInvoiceId !== purchaseInvoiceId) {
      throw new BadRequestException(
        `Invoice item ${purchaseInvoiceItemId} does not belong to Purchase Invoice ${purchaseInvoiceId}.`,
      );
    }
    const alreadyReturned = await this.prisma.purchaseReturnItem.aggregate({
      where: {
        purchaseInvoiceItemId,
        purchaseReturn: {
          status: { not: PurchaseDocumentStatus.CANCELLED },
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

  /** TASK-048 — the return's supplier must match its source invoice's supplier; the invoice must exist and not be deleted. */
  private async assertSourceInvoice(
    purchaseInvoiceId: string,
    supplierId: string,
  ) {
    const invoice = await this.prisma.purchaseInvoice.findFirst({
      where: { id: purchaseInvoiceId, deletedAt: null },
      select: {
        supplierId: true,
        status: true,
        invoiceNumber: true,
        companyId: true,
        branchId: true,
        costCenterId: true,
        projectId: true,
      },
    });
    if (!invoice) {
      throw new NotFoundException(
        `Purchase Invoice ${purchaseInvoiceId} not found`,
      );
    }
    if (invoice.supplierId !== supplierId) {
      throw new BadRequestException(
        'Purchase Return supplier must match the source Purchase Invoice supplier.',
      );
    }
    // TASK-050 — a cancelled invoice can never be returned against.
    if (invoice.status === PurchaseDocumentStatus.CANCELLED) {
      throw new BadRequestException(
        `Cannot create a return against cancelled Purchase Invoice ${invoice.invoiceNumber}.`,
      );
    }
    return invoice;
  }

  private async computeLines(
    items: PurchaseLineItemInputDto[],
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

    const lines: Prisma.PurchaseReturnItemUncheckedCreateWithoutPurchaseReturnInput[] =
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
        purchaseInvoiceItemId: item.purchaseInvoiceItemId,
        taxAmount: computedLines[index].taxAmount,
        lineTotal: computedLines[index].lineTotal,
        notes: item.notes,
      }));

    const totals = computeSalesDocumentTotals(computedLines);

    return { lines, totals };
  }
}
