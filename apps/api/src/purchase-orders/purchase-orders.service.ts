import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  PartnerRoleType,
  Prisma,
  PurchaseDocumentStatus,
  PurchaseOrderStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NumberingEngineService } from '../numbering/numbering-engine.service';
import { PartnersService } from '../partners/partners.service';
import { ProductsService } from '../products/products.service';
import {
  PurchaseOrderActivityService,
  PurchaseOrderActivityType,
} from './activities/purchase-order-activity.service';
import { CreatePurchaseOrderDto } from './dto/create-purchase-order.dto';
import { UpdatePurchaseOrderDto } from './dto/update-purchase-order.dto';
import { FindPurchaseOrdersQueryDto } from './dto/find-purchase-orders-query.dto';
import { ConvertPurchaseOrderToInvoiceDto } from './dto/convert-purchase-order-to-invoice.dto';
import { PurchaseInvoicesService } from '../purchasing/invoices/purchase-invoices.service';
import { buildDateRangeFilter } from '../sales/shared/sales-list-query.util';
import { round2 } from '../sales/shared/sales-totals.util';
import { PurchaseOrderItemInputDto } from './dto/purchase-order-item-input.dto';
import type { CompanyContext } from '../common/decorators/current-company-context.decorator';
import { assertActiveProduct } from '../products/assert-active-product.util';
import { prismaEnumFilter } from '../common/query/enum-list';

const QUOTATION_ACTIVITY_TYPE = {
  QUOTATION_CONVERTED_TO_ORDER: 'QUOTATION_CONVERTED_TO_ORDER',
};

@Injectable()
export class PurchaseOrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly partnersService: PartnersService,
    private readonly productsService: ProductsService,
    private readonly activityService: PurchaseOrderActivityService,
    private readonly numberingEngine: NumberingEngineService,
    private readonly invoicesService: PurchaseInvoicesService,
  ) {}

  /**
   * "Purchase Order is only an agreement to buy." This creates the order and
   * its lines only — no inventory movement, cost update, or accounting entry
   * happens here or in any status transition below.
   */
  async create(
    dto: CreatePurchaseOrderDto,
    context: CompanyContext = { companyId: null, branchId: null },
  ) {
    await this.partnersService.assertActiveForRole(
      dto.partnerId,
      PartnerRoleType.SUPPLIER,
    );
    const productsById = await this.productsService.findManyForValidation(
      dto.items.map((item) => item.productId),
    );
    for (const item of dto.items) {
      assertActiveProduct(item.productId, productsById);
    }

    const poNumber =
      await this.numberingEngine.generateNumber('PURCHASE_ORDER');
    return this.createOrder(
      {
        poNumber,
        partnerId: dto.partnerId,
        quotationId: dto.quotationId ?? null,
        projectId: dto.projectId ?? null,
        costCenterId: dto.costCenterId ?? null,
        currencyId: dto.currencyId ?? null,
        companyId: context.companyId,
        branchId: context.branchId,
        purchaseType: dto.purchaseType,
        expectedDeliveryDate: dto.expectedDeliveryDate
          ? new Date(dto.expectedDeliveryDate)
          : null,
        referenceNumber: dto.referenceNumber ?? null,
        internalNotes: dto.internalNotes ?? null,
        supplierNotes: dto.supplierNotes ?? null,
      },
      await this.computeItems(dto.items),
      PurchaseOrderActivityType.PO_CREATED,
      (po) => `Purchase Order ${po.poNumber} created`,
    );
  }

  /** Draft only — mirrors PurchaseQuotationsService.update(): replaces all items when `items` is sent, never partially patches a line. */
  async update(id: string, dto: UpdatePurchaseOrderDto, userId?: string) {
    const existing = await this.findOne(id);
    if (existing.status !== PurchaseOrderStatus.DRAFT) {
      throw new BadRequestException(
        `Only a Draft Purchase Order can be edited.`,
      );
    }
    if (dto.partnerId) {
      await this.partnersService.assertActiveForRole(
        dto.partnerId,
        PartnerRoleType.SUPPLIER,
      );
    }

    let computedItems:
      Awaited<ReturnType<typeof this.computeItems>> | undefined;
    if (dto.items) {
      const productsById = await this.productsService.findManyForValidation(
        dto.items.map((item) => item.productId),
      );
      for (const item of dto.items) {
        assertActiveProduct(item.productId, productsById);
      }
      computedItems = await this.computeItems(dto.items);
    }

    return this.prisma.$transaction(async (tx) => {
      if (dto.items) {
        await tx.purchaseOrderItem.deleteMany({
          where: { purchaseOrderId: id },
        });
      }
      const po = await tx.purchaseOrder.update({
        where: { id },
        data: {
          partnerId: dto.partnerId,
          projectId: dto.projectId,
          costCenterId: dto.costCenterId,
          currencyId: dto.currencyId,
          purchaseType: dto.purchaseType,
          expectedDeliveryDate: dto.expectedDeliveryDate
            ? new Date(dto.expectedDeliveryDate)
            : undefined,
          referenceNumber: dto.referenceNumber,
          internalNotes: dto.internalNotes,
          supplierNotes: dto.supplierNotes,
          updatedBy: userId ?? null,
          ...(computedItems ? { items: { create: computedItems } } : {}),
        },
        include: {
          partner: true,
          currency: true,
          items: { include: { product: true, unit: true, tax: true } },
        },
      });
      await this.activityService.log(
        id,
        PurchaseOrderActivityType.PO_UPDATED,
        `Purchase Order ${po.poNumber} updated`,
        undefined,
        tx,
      );
      return po;
    });
  }

  /**
   * `subtotal` stays exactly what the caller sent (OrderItem's raw-value
   * convention — never recomputed from quantity/unitPrice here). `taxId` is
   * a real, optional lookup: resolved once per distinct tax, `taxAmount`/
   * `lineTotal` computed server-side so a line with no tax cleanly totals to
   * zero tax, never a forced selection (Additional Business Rules Phase
   * 2.5+ — "Tax can also be left empty").
   */
  private async computeItems(items: PurchaseOrderItemInputDto[]) {
    const taxIds = [
      ...new Set(items.map((i) => i.taxId).filter((id): id is string => !!id)),
    ];
    const taxes =
      taxIds.length > 0
        ? await this.prisma.tax.findMany({ where: { id: { in: taxIds } } })
        : [];
    const taxRateById = new Map(taxes.map((t) => [t.id, Number(t.rate)]));

    return items.map((item) => {
      const ratePercent = item.taxId ? (taxRateById.get(item.taxId) ?? 0) : 0;
      const taxAmount = round2(item.subtotal * (ratePercent / 100));
      return {
        productId: item.productId,
        description: item.description,
        quantity: item.quantity,
        unitId: item.unitId,
        unitPrice: item.unitPrice,
        discountValue: item.discountValue ?? 0,
        discountPercent: item.discountPercent ?? 0,
        subtotal: item.subtotal,
        taxId: item.taxId,
        taxAmount,
        lineTotal: round2(item.subtotal + taxAmount),
        notes: item.notes,
      };
    });
  }

  /**
   * Reads the Quotation directly via Prisma (no dependency on
   * PurchaseQuotationsModule — that module already depends on this one, for
   * the reverse "Convert to Order" delegation; a circular Nest module
   * import is best avoided, same reasoning as
   * SalesInvoicesService.rollUpOrderDelivery). Converts the whole Quotation
   * as-is — no per-line selection/quantity override, since PurchaseOrderItem
   * has no partial-receipt tracking to make that meaningful.
   */
  async createFromQuotation(quotationId: string, userId?: string) {
    const quotation = await this.prisma.purchaseQuotation.findFirst({
      where: { id: quotationId, deletedAt: null },
      include: { items: true },
    });
    if (!quotation) {
      throw new NotFoundException(
        `Purchase Quotation ${quotationId} not found`,
      );
    }
    if (quotation.status !== PurchaseDocumentStatus.APPROVED) {
      throw new BadRequestException(
        `Cannot convert Purchase Quotation ${quotation.quotationNumber} to a Purchase Order unless it is Approved.`,
      );
    }
    await this.partnersService.assertActiveForRole(
      quotation.partnerId,
      PartnerRoleType.SUPPLIER,
    );

    const poNumber =
      await this.numberingEngine.generateNumber('PURCHASE_ORDER');

    return this.createOrder(
      {
        poNumber,
        partnerId: quotation.partnerId,
        quotationId: quotation.id,
        projectId: null,
        costCenterId: null,
        currencyId: quotation.currencyId,
        companyId: quotation.companyId,
        branchId: quotation.branchId,
        purchaseType: quotation.purchaseType,
        expectedDeliveryDate: null,
        referenceNumber: quotation.referenceNumber,
        internalNotes: quotation.internalNotes,
        supplierNotes: quotation.supplierNotes,
      },
      quotation.items.map((item) => ({
        productId: item.productId,
        description: item.description,
        quantity: item.quantity,
        unitId: item.unitId,
        unitPrice: item.unitPrice,
        discountValue: item.discountValue,
        discountPercent: item.discountPercent,
        // subtotal is the taxable amount (line total minus tax) — PO's own
        // caller-supplied-subtotal convention; taxId/taxAmount/lineTotal
        // carry straight over from the Quotation's own tax-aware totals,
        // never recomputed here.
        subtotal: Number(item.lineTotal) - Number(item.taxAmount),
        taxId: item.taxId,
        taxAmount: item.taxAmount,
        lineTotal: item.lineTotal,
        notes: item.notes,
      })),
      PurchaseOrderActivityType.PO_CREATED,
      (po) =>
        `Purchase Order ${po.poNumber} created from Purchase Quotation ${quotation.quotationNumber}`,
      async (tx) => {
        await tx.purchaseQuotation.update({
          where: { id: quotation.id },
          data: { status: PurchaseDocumentStatus.CLOSED },
        });
        await tx.purchaseQuotationActivity.create({
          data: {
            purchaseQuotationId: quotation.id,
            type: QUOTATION_ACTIVITY_TYPE.QUOTATION_CONVERTED_TO_ORDER,
            description: `Converted to Purchase Order ${poNumber}`,
            createdBy: userId ?? null,
          },
        });
      },
    );
  }

  /**
   * "Search" — filters by Supplier/Status/Purchase Type; matches PO/
   * Reference Number. TASK-042 — paginated (`{items,total,page,pageSize}`),
   * matching every other Purchasing list endpoint (Quotation/Invoice/
   * Return) instead of the original bare-array response.
   */
  async findAll(query: FindPurchaseOrdersQueryDto) {
    const where: Prisma.PurchaseOrderWhereInput = {
      deletedAt: null,
      partnerId: prismaEnumFilter(query.partnerId),
      status: prismaEnumFilter(query.status),
      purchaseType: prismaEnumFilter(query.purchaseType),
    };

    if (query.search) {
      where.OR = [
        { poNumber: { contains: query.search, mode: 'insensitive' } },
        { referenceNumber: { contains: query.search, mode: 'insensitive' } },
      ];
    }
    if (query.dateFrom || query.dateTo) {
      where.createdAt = buildDateRangeFilter(query.dateFrom, query.dateTo);
    }

    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const [items, total] = await Promise.all([
      this.prisma.purchaseOrder.findMany({
        where,
        include: {
          partner: true,
          currency: true,
          items: { include: { product: true, unit: true, tax: true } },
        },
        orderBy: { [query.sortBy || 'createdAt']: query.sortOrder ?? 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.purchaseOrder.count({ where }),
    ]);

    return { items, total, page, pageSize };
  }

  /** "Details." */
  async findOne(id: string) {
    const po = await this.prisma.purchaseOrder.findFirst({
      where: { id, deletedAt: null },
      include: {
        partner: true,
        currency: true,
        items: { include: { product: true, unit: true, tax: true } },
        // TASK-050 — Related Documents: the source Purchase Quotation (if
        // converted from one) and the Purchase Invoice(s) converted from
        // this order, for the editor's reference-links section.
        quotation: { select: { id: true, quotationNumber: true } },
        invoices: {
          where: { deletedAt: null },
          select: { id: true, invoiceNumber: true, status: true },
        },
      },
    });
    if (!po) {
      throw new NotFoundException(`Purchase Order ${id} not found`);
    }
    return po;
  }

  approve(id: string) {
    return this.transition(
      id,
      [PurchaseOrderStatus.DRAFT],
      PurchaseOrderStatus.APPROVED,
      PurchaseOrderActivityType.PO_APPROVED,
      'approved',
    );
  }

  cancel(id: string) {
    return this.transition(
      id,
      [PurchaseOrderStatus.DRAFT, PurchaseOrderStatus.APPROVED],
      PurchaseOrderStatus.CANCELLED,
      PurchaseOrderActivityType.PO_CANCELLED,
      'cancelled',
    );
  }

  close(id: string) {
    return this.transition(
      id,
      [PurchaseOrderStatus.APPROVED],
      PurchaseOrderStatus.CLOSED,
      PurchaseOrderActivityType.PO_CLOSED,
      'closed',
    );
  }

  /**
   * Soft-delete (TASK-042) — hides the PO from findAll/findOne without
   * destroying data, mirroring the "Archive is soft-delete" pattern every
   * other Purchasing document already uses. `deletedAt` already existed on
   * this model (ADR-0015) but was never exposed through an endpoint — this
   * is purely additive, no migration needed. Only allowed once the PO is no
   * longer actively progressing (Draft/Cancelled/Closed), same as
   * PurchaseQuotationsService.archive's allowed-from set.
   */
  async archive(id: string, userId?: string) {
    const po = await this.findOne(id);
    const archivableFrom: PurchaseOrderStatus[] = [
      PurchaseOrderStatus.DRAFT,
      PurchaseOrderStatus.CANCELLED,
      PurchaseOrderStatus.CLOSED,
    ];
    if (!archivableFrom.includes(po.status)) {
      throw new BadRequestException(
        `Cannot archive Purchase Order ${po.poNumber} while it is ${po.status}.`,
      );
    }
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.purchaseOrder.update({
        where: { id },
        data: { deletedAt: new Date(), updatedBy: userId ?? null },
        include: {
          partner: true,
          currency: true,
          items: { include: { product: true, unit: true, tax: true } },
        },
      });
      await this.activityService.log(
        id,
        PurchaseOrderActivityType.PO_ARCHIVED,
        `Purchase Order ${po.poNumber} archived`,
        undefined,
        tx,
      );
      return updated;
    });
  }

  /**
   * PO → Purchase Invoice (Goods Receipt) — delegates the actual Invoice
   * creation to PurchaseInvoicesService.createFromOrder. Full conversion
   * only (every PO line, at its ordered quantity) — PurchaseOrderItem has
   * no partial-receipt tracking, matching `createFromQuotation`'s note.
   */
  async convertToInvoice(
    id: string,
    dto: ConvertPurchaseOrderToInvoiceDto,
    userId?: string,
  ) {
    const po = await this.findOne(id);
    if (po.status !== PurchaseOrderStatus.APPROVED) {
      throw new BadRequestException(
        `Cannot receive goods for Purchase Order ${po.poNumber} from ${po.status}.`,
      );
    }
    return this.invoicesService.createFromOrder(
      po,
      po.items,
      dto.warehouseId,
      userId,
    );
  }

  /** Status management only — never touches inventory, cost, or accounting. */
  private async transition(
    id: string,
    allowedFrom: PurchaseOrderStatus[],
    to: PurchaseOrderStatus,
    activityType: string,
    verb: string,
  ) {
    const po = await this.findOne(id);
    if (!allowedFrom.includes(po.status)) {
      throw new BadRequestException(
        `Cannot transition Purchase Order ${po.poNumber} from ${po.status} to ${to}.`,
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.purchaseOrder.update({
        where: { id },
        data: { status: to },
      });
      await this.activityService.log(
        id,
        activityType,
        `Purchase Order ${po.poNumber} ${verb}`,
        undefined,
        tx,
      );
      return updated;
    });
  }

  private async createOrder(
    header: Prisma.PurchaseOrderUncheckedCreateWithoutItemsInput,
    items: Prisma.PurchaseOrderItemUncheckedCreateWithoutPurchaseOrderInput[],
    activityType: string,
    describe: (po: { poNumber: string }) => string,
    beforeCommit?: (tx: Prisma.TransactionClient) => Promise<void>,
  ) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const po = await tx.purchaseOrder.create({
          data: { ...header, items: { create: items } },
          include: {
            partner: true,
            currency: true,
            items: { include: { product: true, unit: true, tax: true } },
          },
        });
        if (beforeCommit) {
          await beforeCommit(tx);
        }
        await this.activityService.log(
          po.id,
          activityType,
          describe(po),
          undefined,
          tx,
        );
        return po;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2002') {
          throw new BadRequestException('PO Number must be unique.');
        }
        if (error.code === 'P2003') {
          throw new BadRequestException(
            'Invalid partner, project, cost center, currency, product, or unit reference.',
          );
        }
      }
      throw error;
    }
  }
}
