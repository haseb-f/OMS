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
import {
  SalesQuotationActivityService,
  SalesQuotationActivityType,
} from './activities/sales-quotation-activity.service';
import {
  computeSalesDocumentTotals,
  computeSalesLine,
} from '../shared/sales-totals.util';
import { buildDateRangeFilter } from '../shared/sales-list-query.util';
import type { CompanyContext } from '../../common/decorators/current-company-context.decorator';
import { CreateSalesQuotationDto } from './dto/create-sales-quotation.dto';
import { UpdateSalesQuotationDto } from './dto/update-sales-quotation.dto';
import { FindSalesQuotationsQueryDto } from './dto/find-sales-quotations-query.dto';
import type { SalesLineItemInputDto } from '../shared/sales-line-item-input.dto';

@Injectable()
export class SalesQuotationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly customersService: CustomersService,
    private readonly productsService: ProductsService,
    private readonly warehousesService: WarehousesService,
    private readonly activityService: SalesQuotationActivityService,
    private readonly numberingEngine: NumberingEngineService,
  ) {}

  async create(
    dto: CreateSalesQuotationDto,
    context: CompanyContext = { companyId: null, branchId: null },
  ) {
    await this.customersService.assertActiveCustomer(dto.customerId);
    for (const item of dto.items) {
      await this.assertActiveProduct(item.productId);
      await this.assertQuotationWarehouse(item.warehouseId);
    }
    const computed = await this.computeLines(dto.items);

    const quotationNumber =
      await this.numberingEngine.generateNumber('QUOTATION');
    try {
      return await this.prisma.$transaction(async (tx) => {
        const quotation = await tx.salesQuotation.create({
          data: {
            quotationNumber,
            customerId: dto.customerId,
            currencyId: dto.currencyId,
            companyId: context.companyId ?? undefined,
            branchId: context.branchId ?? undefined,
            documentDate: dto.documentDate
              ? new Date(dto.documentDate)
              : undefined,
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
          quotation.id,
          SalesQuotationActivityType.QUOTATION_CREATED,
          `Quotation ${quotation.quotationNumber} created`,
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
          'Invalid customer, currency, product, warehouse, unit, or tax reference.',
        );
      }
      throw error;
    }
  }

  async findAll(query: FindSalesQuotationsQueryDto) {
    const where: Prisma.SalesQuotationWhereInput = {
      deletedAt: null,
      customerId: query.customerId,
      status: query.status,
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
      this.prisma.salesQuotation.findMany({
        where,
        include: { items: true, customer: true, currency: true },
        orderBy: { [query.sortBy || 'createdAt']: query.sortOrder ?? 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.salesQuotation.count({ where }),
    ]);

    return { items, total, page, pageSize };
  }

  async findOne(id: string) {
    const quotation = await this.prisma.salesQuotation.findFirst({
      where: { id, deletedAt: null },
      include: {
        customer: true,
        currency: true,
        items: {
          include: { product: true, warehouse: true, unit: true, tax: true },
        },
      },
    });
    if (!quotation) {
      throw new NotFoundException(`Quotation ${id} not found`);
    }
    return quotation;
  }

  /** Draft-only edit — replaces the full line-item set when `items` is supplied; leaves totals untouched otherwise. */
  async update(id: string, dto: UpdateSalesQuotationDto) {
    const existing = await this.findOne(id);
    if (existing.status !== SalesDocumentStatus.DRAFT) {
      throw new BadRequestException('Only a Draft quotation can be edited.');
    }

    if (dto.customerId) {
      await this.customersService.assertActiveCustomer(dto.customerId);
    }

    let computed: Awaited<ReturnType<typeof this.computeLines>> | undefined;
    if (dto.items) {
      for (const item of dto.items) {
        await this.assertActiveProduct(item.productId);
        await this.assertQuotationWarehouse(item.warehouseId);
      }
      computed = await this.computeLines(dto.items);
    }

    return this.prisma.$transaction(async (tx) => {
      if (dto.items) {
        await tx.salesQuotationItem.deleteMany({
          where: { salesQuotationId: id },
        });
      }
      const quotation = await tx.salesQuotation.update({
        where: { id },
        data: {
          customerId: dto.customerId,
          currencyId: dto.currencyId,
          documentDate: dto.documentDate
            ? new Date(dto.documentDate)
            : undefined,
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
        SalesQuotationActivityType.QUOTATION_UPDATED,
        `Quotation ${quotation.quotationNumber} updated`,
        undefined,
        tx,
      );
      return quotation;
    });
  }

  submit(id: string) {
    return this.transition(
      id,
      [SalesDocumentStatus.DRAFT],
      SalesDocumentStatus.PENDING_APPROVAL,
      SalesQuotationActivityType.QUOTATION_SUBMITTED,
      'submitted for approval',
    );
  }

  approve(id: string) {
    return this.transition(
      id,
      [SalesDocumentStatus.PENDING_APPROVAL],
      SalesDocumentStatus.APPROVED,
      SalesQuotationActivityType.QUOTATION_APPROVED,
      'approved',
      { confirmedAt: new Date() },
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
      SalesQuotationActivityType.QUOTATION_CANCELLED,
      'cancelled',
      { cancelledAt: new Date(), cancelledBy: userId ?? null },
    );
  }

  /**
   * Soft-delete — hides the quotation from findAll/findOne without
   * destroying data, mirroring the "Archive is soft-delete" pattern already
   * used for Product/Supplier. Only allowed once the quotation is no longer
   * actively progressing (Draft/Cancelled/Closed) — archiving something
   * mid-workflow would hide it from the very list a user needs to act on.
   */
  async archive(id: string, userId?: string) {
    const quotation = await this.findOne(id);
    const archivableFrom: SalesDocumentStatus[] = [
      SalesDocumentStatus.DRAFT,
      SalesDocumentStatus.CANCELLED,
      SalesDocumentStatus.CLOSED,
    ];
    if (!archivableFrom.includes(quotation.status)) {
      throw new BadRequestException(
        `Cannot archive Quotation ${quotation.quotationNumber} while it is ${quotation.status}.`,
      );
    }
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.salesQuotation.update({
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
        SalesQuotationActivityType.QUOTATION_ARCHIVED,
        `Quotation ${quotation.quotationNumber} archived`,
        undefined,
        tx,
      );
      return updated;
    });
  }

  /** Marks the quotation Closed once it has produced a Sales Order — called by SalesOrdersService.createFromQuotation. */
  async markClosed(id: string, tx: Prisma.TransactionClient) {
    await tx.salesQuotation.update({
      where: { id },
      data: { status: SalesDocumentStatus.CLOSED },
    });
    await this.activityService.log(
      id,
      SalesQuotationActivityType.QUOTATION_CONVERTED_TO_ORDER,
      'Converted to Sales Order',
      undefined,
      tx,
    );
  }

  private async transition(
    id: string,
    allowedFrom: SalesDocumentStatus[],
    to: SalesDocumentStatus,
    activityType: string,
    verb: string,
    extraData: Prisma.SalesQuotationUpdateInput = {},
  ) {
    const quotation = await this.findOne(id);
    if (!allowedFrom.includes(quotation.status)) {
      throw new BadRequestException(
        `Cannot transition Quotation ${quotation.quotationNumber} from ${quotation.status} to ${to}.`,
      );
    }
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.salesQuotation.update({
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
        `Quotation ${quotation.quotationNumber} ${verb}`,
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

  /**
   * TASK-040 — Warehouse is now required on every Quotation line (a
   * deliberate business-rule change from TASK-037, which left it optional
   * since a schema-level `warehouseId` column stays nullable for all four
   * Sales documents — see `SalesLineItemInputDto`). Enforced here in the
   * service, the same way Order/Invoice/Return enforce it, rather than at
   * the DTO/DB level, since Postgres NOT NULL can't express "required for
   * this document type only."
   */
  private async assertQuotationWarehouse(warehouseId: string | undefined) {
    if (!warehouseId) {
      throw new BadRequestException(
        'Warehouse is required on every Quotation line.',
      );
    }
    const warehouse = await this.warehousesService.findOne(warehouseId);
    if (!warehouse.isActive) {
      throw new BadRequestException('Warehouse is inactive.');
    }
    return warehouse;
  }

  /** Resolves each line's tax rate, computes per-line + document totals — shared math, see sales-totals.util.ts. */
  private async computeLines(items: SalesLineItemInputDto[]) {
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
      warehouseId: item.warehouseId,
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
