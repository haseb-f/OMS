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
  SalesDocumentStatus,
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
import { resolveLineTaxes } from '../../taxes/document-tax';
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
import { assertActiveProduct } from '../../products/assert-active-product.util';
import { prismaEnumFilter } from '../../common/query/enum-list';

const REFERENCE_TYPE = 'SALES_RETURN';

interface ComputedReturnLines {
  lines: Prisma.SalesReturnItemUncheckedCreateWithoutSalesReturnInput[];
  totals: ReturnType<typeof computeSalesDocumentTotals>;
}

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
    for (const item of dto.items) {
      assertActiveProduct(item.productId, productsById);
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
            partnerId: dto.partnerId,
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
      for (const item of dto.items) {
        assertActiveProduct(item.productId, productsById);
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
      await this.returnStock(tx, salesReturn, userId);

      const updated = await tx.salesReturn.update({
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
        `Sales Return ${salesReturn.returnNumber} ${verb}`,
        undefined,
        tx,
      );
      return updated;
    });
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

  /** TASK-048 — the return's partner must match its source invoice's partner; the invoice must exist and not be deleted. */
  private async assertSourceInvoice(salesInvoiceId: string, partnerId: string) {
    const invoice = await this.prisma.salesInvoice.findFirst({
      where: { id: salesInvoiceId, deletedAt: null },
      select: {
        partnerId: true,
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
