import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, PurchaseDocumentStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { NumberingEngineService } from '../../numbering/numbering-engine.service';
import { ProductsService } from '../../products/products.service';
import { SuppliersService } from '../../suppliers/suppliers.service';
import {
  PurchaseQuotationActivityService,
  PurchaseQuotationActivityType,
} from './activities/purchase-quotation-activity.service';
import {
  computeSalesDocumentTotals,
  computeSalesLine,
} from '../../sales/shared/sales-totals.util';
import { buildDateRangeFilter } from '../../sales/shared/sales-list-query.util';
import type { CompanyContext } from '../../common/decorators/current-company-context.decorator';
import { CreatePurchaseQuotationDto } from './dto/create-purchase-quotation.dto';
import { UpdatePurchaseQuotationDto } from './dto/update-purchase-quotation.dto';
import { FindPurchaseQuotationsQueryDto } from './dto/find-purchase-quotations-query.dto';
import type { PurchaseLineItemInputDto } from '../shared/purchase-line-item-input.dto';
import { assertActiveProduct } from '../../products/assert-active-product.util';
import { prismaEnumFilter } from '../../common/query/enum-list';

@Injectable()
export class PurchaseQuotationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly suppliersService: SuppliersService,
    private readonly productsService: ProductsService,
    private readonly activityService: PurchaseQuotationActivityService,
    private readonly numberingEngine: NumberingEngineService,
  ) {}

  async create(
    dto: CreatePurchaseQuotationDto,
    context: CompanyContext = { companyId: null, branchId: null },
  ) {
    await this.suppliersService.assertActiveSupplier(dto.supplierId);
    const productsById = await this.productsService.findManyForValidation(
      dto.items.map((item) => item.productId),
    );
    for (const item of dto.items) {
      assertActiveProduct(item.productId, productsById);
    }
    const computed = await this.computeLines(dto.items);

    const quotationNumber =
      await this.numberingEngine.generateNumber('PURCHASE_QUOTATION');
    try {
      return await this.prisma.$transaction(async (tx) => {
        const quotation = await tx.purchaseQuotation.create({
          data: {
            quotationNumber,
            supplierId: dto.supplierId,
            currencyId: dto.currencyId,
            companyId: context.companyId ?? undefined,
            branchId: context.branchId ?? undefined,
            purchaseType: dto.purchaseType,
            documentDate: dto.documentDate
              ? new Date(dto.documentDate)
              : undefined,
            referenceNumber: dto.referenceNumber,
            internalNotes: dto.internalNotes,
            supplierNotes: dto.supplierNotes,
            ...computed.totals,
            items: { create: computed.lines },
          },
          include: {
            supplier: true,
            currency: true,
            items: { include: { product: true, unit: true, tax: true } },
          },
        });
        await this.activityService.log(
          quotation.id,
          PurchaseQuotationActivityType.QUOTATION_CREATED,
          `Purchase Quotation ${quotation.quotationNumber} created`,
          undefined,
          tx,
        );
        return quotation;
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2003'
      ) {
        throw new BadRequestException(
          'Invalid supplier, currency, product, unit, or tax reference.',
        );
      }
      throw error;
    }
  }

  async findAll(query: FindPurchaseQuotationsQueryDto) {
    const where: Prisma.PurchaseQuotationWhereInput = {
      deletedAt: null,
      supplierId: prismaEnumFilter(query.supplierId),
      status: prismaEnumFilter(query.status),
    };
    if (query.search) {
      where.OR = [
        { quotationNumber: { contains: query.search, mode: 'insensitive' } },
        { referenceNumber: { contains: query.search, mode: 'insensitive' } },
      ];
    }
    if (query.dateFrom || query.dateTo) {
      where.createdAt = buildDateRangeFilter(query.dateFrom, query.dateTo);
    }

    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const [items, total] = await Promise.all([
      this.prisma.purchaseQuotation.findMany({
        where,
        include: {
          items: {
            include: {
              product: { select: { id: true, name: true, sku: true } },
            },
          },
          supplier: true,
          currency: true,
        },
        orderBy: { [query.sortBy || 'createdAt']: query.sortOrder ?? 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.purchaseQuotation.count({ where }),
    ]);

    return { items, total, page, pageSize };
  }

  async findOne(id: string) {
    const quotation = await this.prisma.purchaseQuotation.findFirst({
      where: { id, deletedAt: null },
      include: {
        supplier: true,
        currency: true,
        items: { include: { product: true, unit: true, tax: true } },
      },
    });
    if (!quotation) {
      throw new NotFoundException(`Purchase Quotation ${id} not found`);
    }
    return quotation;
  }

  /** Draft-only edit — replaces the full line-item set when `items` is supplied. */
  async update(id: string, dto: UpdatePurchaseQuotationDto) {
    const existing = await this.findOne(id);
    if (existing.status !== PurchaseDocumentStatus.DRAFT) {
      throw new BadRequestException(
        'Only a Draft Purchase Quotation can be edited.',
      );
    }
    if (dto.supplierId) {
      await this.suppliersService.assertActiveSupplier(dto.supplierId);
    }

    let computed: Awaited<ReturnType<typeof this.computeLines>> | undefined;
    if (dto.items) {
      const productsById = await this.productsService.findManyForValidation(
        dto.items.map((item) => item.productId),
      );
      for (const item of dto.items) {
        assertActiveProduct(item.productId, productsById);
      }
      computed = await this.computeLines(dto.items);
    }

    return this.prisma.$transaction(async (tx) => {
      if (dto.items) {
        await tx.purchaseQuotationItem.deleteMany({
          where: { purchaseQuotationId: id },
        });
      }
      const quotation = await tx.purchaseQuotation.update({
        where: { id },
        data: {
          supplierId: dto.supplierId,
          currencyId: dto.currencyId,
          purchaseType: dto.purchaseType,
          documentDate: dto.documentDate
            ? new Date(dto.documentDate)
            : undefined,
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
          items: { include: { product: true, unit: true, tax: true } },
        },
      });
      await this.activityService.log(
        id,
        PurchaseQuotationActivityType.QUOTATION_UPDATED,
        `Purchase Quotation ${quotation.quotationNumber} updated`,
        undefined,
        tx,
      );
      return quotation;
    });
  }

  submit(id: string) {
    return this.transition(
      id,
      [PurchaseDocumentStatus.DRAFT],
      PurchaseDocumentStatus.PENDING_APPROVAL,
      PurchaseQuotationActivityType.QUOTATION_SUBMITTED,
      'submitted for approval',
    );
  }

  approve(id: string) {
    return this.transition(
      id,
      [PurchaseDocumentStatus.PENDING_APPROVAL],
      PurchaseDocumentStatus.APPROVED,
      PurchaseQuotationActivityType.QUOTATION_APPROVED,
      'approved',
      { confirmedAt: new Date() },
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
      PurchaseQuotationActivityType.QUOTATION_CANCELLED,
      'cancelled',
      { cancelledAt: new Date(), cancelledBy: userId ?? null },
    );
  }

  /**
   * Soft-delete — hides the quotation from findAll/findOne without
   * destroying data, mirroring the "Archive is soft-delete" pattern already
   * used for Product/Supplier. Only allowed once the quotation is no longer
   * actively progressing (Draft/Cancelled/Closed).
   */
  async archive(id: string, userId?: string) {
    const quotation = await this.findOne(id);
    const archivableFrom: PurchaseDocumentStatus[] = [
      PurchaseDocumentStatus.DRAFT,
      PurchaseDocumentStatus.CANCELLED,
      PurchaseDocumentStatus.CLOSED,
    ];
    if (!archivableFrom.includes(quotation.status)) {
      throw new BadRequestException(
        `Cannot archive Purchase Quotation ${quotation.quotationNumber} while it is ${quotation.status}.`,
      );
    }
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.purchaseQuotation.update({
        where: { id },
        data: { deletedAt: new Date(), updatedBy: userId ?? null },
        include: {
          supplier: true,
          currency: true,
          items: { include: { product: true, unit: true, tax: true } },
        },
      });
      await this.activityService.log(
        id,
        PurchaseQuotationActivityType.QUOTATION_ARCHIVED,
        `Purchase Quotation ${quotation.quotationNumber} archived`,
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
    extraData: Prisma.PurchaseQuotationUpdateInput = {},
  ) {
    const quotation = await this.findOne(id);
    if (!allowedFrom.includes(quotation.status)) {
      throw new BadRequestException(
        `Cannot transition Purchase Quotation ${quotation.quotationNumber} from ${quotation.status} to ${to}.`,
      );
    }
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.purchaseQuotation.update({
        where: { id },
        data: { status: to, ...extraData },
        include: {
          supplier: true,
          currency: true,
          items: { include: { product: true, unit: true, tax: true } },
        },
      });
      await this.activityService.log(
        id,
        activityType,
        `Purchase Quotation ${quotation.quotationNumber} ${verb}`,
        undefined,
        tx,
      );
      return updated;
    });
  }

  /** Resolves each line's tax rate, computes per-line + document totals — shared math, see sales/shared/sales-totals.util.ts. */
  private async computeLines(items: PurchaseLineItemInputDto[]) {
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

    const lines = items.map((item, index) => ({
      productId: item.productId,
      description: item.description,
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
