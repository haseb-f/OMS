import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  PartnerRoleType,
  Prisma,
  PurchaseDocumentStatus,
  PurchaseLineTreatment,
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
import { assertNoKitProducts } from '../shared/purchase-kit-guard';
import { PostingEngineService } from '../../accounting/posting-engine/posting-engine.service';
import { InventoryValuationService } from '../../accounting/inventory-valuation/inventory-valuation.service';
import { resolveLineTaxes } from '../../taxes/document-tax';
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
import { assertActiveProduct } from '../../products/assert-active-product.util';
import { prismaEnumFilter } from '../../common/query/enum-list';
import { FixedAssetsService } from '../../fixed-assets/fixed-assets.service';
import { PrepaidExpensesService } from '../../prepaid-expenses/prepaid-expenses.service';
import { todayBusinessDate } from '../../common/time/business-date';
import { dateOnly } from '../../accounting/schedules/schedule-due';

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Invoice-line fields a return of a capitalized / deferred line is judged on. */
const TREATED_LINE_SELECT = {
  id: true,
  treatment: true,
  quantity: true,
  unitPrice: true,
  discountPercent: true,
  discountValue: true,
  taxId: true,
  linkedFixedAssetId: true,
  linkedFixedAsset: { select: { code: true } },
  purchaseInvoice: {
    select: { status: true, invoiceNumber: true, exchangeRate: true },
  },
  fixedAsset: {
    select: { id: true, code: true, status: true, deletedAt: true },
  },
  prepaidExpense: {
    select: {
      id: true,
      prepaidNumber: true,
      status: true,
      amount: true,
      recognizedAmount: true,
      deletedAt: true,
    },
  },
} satisfies Prisma.PurchaseInvoiceItemSelect;

type TreatedInvoiceLine = Prisma.PurchaseInvoiceItemGetPayload<{
  select: typeof TREATED_LINE_SELECT;
}>;

type DecimalInput = Prisma.Decimal | Prisma.DecimalJsLike | number | string;

/** A computed return line, as stored. */
interface ReturnLineValues {
  purchaseInvoiceItemId?: string | null;
  quantity: number;
  unitPrice: DecimalInput;
  discountPercent?: DecimalInput | null;
  discountValue?: DecimalInput | null;
  taxId?: string | null;
  lineTotal: DecimalInput;
  taxAmount?: DecimalInput;
}

const REFERENCE_TYPE = 'PURCHASE_RETURN';

interface ComputedReturnLines {
  lines: Prisma.PurchaseReturnItemUncheckedCreateWithoutPurchaseReturnInput[];
  totals: ReturnType<typeof computeSalesDocumentTotals>;
}

@Injectable()
export class PurchaseReturnsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly partnersService: PartnersService,
    private readonly productsService: ProductsService,
    private readonly warehousesService: WarehousesService,
    private readonly inventoryService: InventoryService,
    private readonly activityService: PurchaseReturnActivityService,
    private readonly numberingEngine: NumberingEngineService,
    private readonly postingEngine: PostingEngineService,
    private readonly fixedAssets: FixedAssetsService,
    private readonly prepaidExpenses: PrepaidExpensesService,
    private readonly inventoryValuation: InventoryValuationService,
  ) {}

  async create(dto: CreatePurchaseReturnDto) {
    await this.partnersService.assertActiveForRole(
      dto.partnerId,
      PartnerRoleType.SUPPLIER,
    );
    const sourceInvoice = await this.assertSourceInvoice(
      dto.purchaseInvoiceId,
      dto.partnerId,
    );
    const productsById = await this.productsService.findManyForValidation(
      dto.items.map((item) => item.productId),
    );
    for (const item of dto.items) {
      assertActiveProduct(item.productId, productsById);
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
    await this.assertTreatedLinesReturnable(computed.lines);
    const returnNumber =
      await this.numberingEngine.generateNumber('PURCHASE_RETURN');

    try {
      return await this.prisma.$transaction(async (tx) => {
        const purchaseReturn = await tx.purchaseReturn.create({
          data: {
            returnNumber,
            partnerId: dto.partnerId,
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
          'Invalid partner, invoice, currency, product, warehouse, unit, or tax reference.',
        );
      }
      throw error;
    }
  }

  async findAll(query: FindPurchaseReturnsQueryDto) {
    const where: Prisma.PurchaseReturnWhereInput = {
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
      this.prisma.purchaseReturn.findMany({
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
      this.prisma.purchaseReturn.count({ where }),
    ]);

    return { items, total, page, pageSize };
  }

  async findOne(id: string) {
    const purchaseReturn = await this.prisma.purchaseReturn.findFirst({
      where: { id, deletedAt: null },
      include: {
        partner: true,
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

    const treated = await this.prisma.purchaseInvoiceItem.findMany({
      where: {
        id: { in: invoice.items.map((item) => item.id) },
        treatment: { not: PurchaseLineTreatment.STANDARD },
      },
      select: TREATED_LINE_SELECT,
    });
    const blockedById = new Map<string, string>();
    for (const line of treated) {
      const returnedQuantity = returnedById.get(line.id) ?? 0;
      if (returnedQuantity >= line.quantity) continue;
      try {
        // A full return at the invoiced amounts — the most a user may ask.
        await this.assertTreatedLine(line, {
          purchaseInvoiceItemId: line.id,
          quantity: line.quantity - returnedQuantity,
          unitPrice: line.unitPrice,
          discountPercent: line.discountPercent,
          discountValue: line.discountValue,
          taxId: line.taxId,
          lineTotal: 0,
          taxAmount: 0,
        });
      } catch (error) {
        if (error instanceof BadRequestException) {
          blockedById.set(line.id, error.message);
        } else throw error;
      }
    }
    const treatmentById = new Map(
      treated.map((line) => [line.id, line.treatment]),
    );

    return {
      items: invoice.items.map((item) => {
        const returnedQuantity = returnedById.get(item.id) ?? 0;
        const treatment =
          treatmentById.get(item.id) ?? PurchaseLineTreatment.STANDARD;
        return {
          purchaseInvoiceItemId: item.id,
          invoicedQuantity: item.quantity,
          returnedQuantity,
          remainingQuantity: item.quantity - returnedQuantity,
          // R13b — capitalized / deferred lines: whether (and why not) the
          // line can be returned; an asset line is returned whole only.
          treatment,
          wholeLineOnly: treatment === PurchaseLineTreatment.FIXED_ASSET,
          returnBlockedReason: blockedById.get(item.id) ?? null,
        };
      }),
    };
  }

  async update(id: string, dto: UpdatePurchaseReturnDto) {
    const existing = await this.findOne(id);
    if (existing.status !== PurchaseDocumentStatus.DRAFT) {
      throw new BadRequestException('Only a Draft return can be edited.');
    }
    if (dto.partnerId) {
      await this.partnersService.assertActiveForRole(
        dto.partnerId,
        PartnerRoleType.SUPPLIER,
      );
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
      const productsById = await this.productsService.findManyForValidation(
        dto.items.map((item) => item.productId),
      );
      for (const item of dto.items) {
        assertActiveProduct(item.productId, productsById);
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
      await this.assertTreatedLinesReturnable(computed.lines);
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
          partnerId: dto.partnerId,
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
          partner: true,
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
      // F12 — a service / non-stock line sends no goods back (it used to
      // fail the whole confirm). Stocked lines: every product row locked
      // once, each movement keyed per return line (never posted twice).
      const stocked = purchaseReturn.items.filter(
        (item) => item.product.isInventoryItem,
      );
      await lockProductsForUpdate(
        tx,
        stocked.map((item) => item.productId),
      );
      // O9 (owner decision 2026-10-06) — the units leave at the moving
      // average read under the lock (no recorded cost → 422); the movement
      // records it, and the posting relieves Inventory at exactly that cost.
      const reliefCosts =
        await this.inventoryValuation.getPurchaseReturnReliefCosts(
          tx,
          stocked.map((item) => item.product),
        );
      for (const item of stocked) {
        await this.inventoryService.postPurchaseReturn(
          {
            productId: item.productId,
            warehouseId: item.warehouseId,
            quantity: item.quantity,
            unitCost: reliefCosts.get(item.productId),
            referenceType: REFERENCE_TYPE,
            referenceId: purchaseReturn.id,
            idempotencyKey: movementIdempotencyKey(
              REFERENCE_TYPE,
              purchaseReturn.id,
              item.id,
              'PURCHASE_RETURN',
            ),
          },
          userId,
          tx,
        );
      }

      const treated = await this.settleTreatedLines(purchaseReturn, tx, userId);

      const updated = await tx.purchaseReturn.update({
        where: { id },
        data: {
          status: PurchaseDocumentStatus.CONFIRMED,
          confirmedAt: new Date(),
          confirmedBy: userId ?? null,
          // A returned asset / prepayment line is derecognized at the rate it
          // was capitalized / deferred at, so the credit to Fixed Assets /
          // Prepayments equals exactly what the invoice debited.
          ...(treated.invoiceRate != null && purchaseReturn.exchangeRate == null
            ? { exchangeRate: treated.invoiceRate }
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
   * R13b — inside the confirm transaction: every returned FIXED_ASSET line
   * derecognizes its asset (DISPOSED, linked to this return, PENDING periods
   * CANCELLED; the return JE credits Fixed Assets — no disposal entry), and
   * every returned PREPAID_EXPENSE line closes its prepayment (the return JE
   * credits Prepayments for the returned amount; any unrecognized excess is
   * expensed). Every rule is re-checked under the record's row lock.
   */
  private async settleTreatedLines(
    purchaseReturn: {
      id: string;
      returnNumber: string;
      items: ReturnLineValues[];
    },
    tx: Prisma.TransactionClient,
    userId?: string,
  ): Promise<{ invoiceRate: Prisma.Decimal | null }> {
    const itemIds = purchaseReturn.items.flatMap((item) =>
      item.purchaseInvoiceItemId ? [item.purchaseInvoiceItemId] : [],
    );
    const treated = await tx.purchaseInvoiceItem.findMany({
      where: {
        id: { in: itemIds },
        treatment: { not: PurchaseLineTreatment.STANDARD },
      },
      select: TREATED_LINE_SELECT,
    });
    if (treated.length === 0) return { invoiceRate: null };
    const today = todayBusinessDate();
    for (const line of treated) {
      const returnLine = purchaseReturn.items.find(
        (item) => item.purchaseInvoiceItemId === line.id,
      )!;
      await this.assertTreatedLine(line, returnLine, tx);
      if (line.treatment === PurchaseLineTreatment.FIXED_ASSET) {
        await this.fixedAssets.derecognizeByPurchaseReturn(
          line.fixedAsset!.id,
          purchaseReturn,
          {
            invoicedQuantity: line.quantity,
            returnedQuantity: returnLine.quantity,
          },
          dateOnly(today),
          tx,
          userId,
        );
      } else {
        await this.prepaidExpenses.closeForPurchaseReturn(
          line.prepaidExpense!.id,
          {
            id: purchaseReturn.id,
            returnNumber: purchaseReturn.returnNumber,
            amount: this.returnedBaseAmount(line, returnLine),
          },
          today,
          tx,
          userId,
        );
      }
    }
    return { invoiceRate: treated[0].purchaseInvoice.exchangeRate };
  }

  /** Save-time checks of every capitalized / deferred line of a return. */
  private async assertTreatedLinesReturnable(lines: ReturnLineValues[]) {
    const itemIds = lines.flatMap((line) =>
      line.purchaseInvoiceItemId ? [line.purchaseInvoiceItemId] : [],
    );
    const treated = await this.prisma.purchaseInvoiceItem.findMany({
      where: {
        id: { in: itemIds },
        treatment: { not: PurchaseLineTreatment.STANDARD },
      },
      select: TREATED_LINE_SELECT,
    });
    for (const line of treated) {
      const returnLine = lines.find(
        (item) => item.purchaseInvoiceItemId === line.id,
      )!;
      await this.assertTreatedLine(line, returnLine);
    }
  }

  /**
   * R13b (O-1 / O-3) — the rules for returning a capitalized / deferred line:
   *  - the invoice must be confirmed (that is when the asset / prepayment exists);
   *  - FIXED_ASSET: a cost-addition line cannot be returned; the asset line is
   *    returned whole, at its invoiced price / discount / tax, and only while
   *    the asset has no posted depreciation (otherwise: dispose it to the
   *    supplier — Dispose → supplier credit);
   *  - PREPAID_EXPENSE: the prepayment is ACTIVE and the returned base amount
   *    does not exceed its unrecognized balance.
   */
  private async assertTreatedLine(
    line: TreatedInvoiceLine,
    returnLine: ReturnLineValues,
    client: Prisma.TransactionClient = this.prisma,
  ): Promise<void> {
    if (line.purchaseInvoice.status !== PurchaseDocumentStatus.CONFIRMED) {
      throw new BadRequestException(
        `Purchase Invoice ${line.purchaseInvoice.invoiceNumber} is ${line.purchaseInvoice.status}; a line recorded as a fixed asset or prepaid expense can be returned only after the invoice is confirmed.`,
      );
    }
    if (line.treatment === PurchaseLineTreatment.FIXED_ASSET) {
      if (line.linkedFixedAssetId) {
        throw new BadRequestException(
          `This invoice line added its cost to fixed asset ${line.linkedFixedAsset?.code ?? ''} and cannot be returned on its own. Dispose the asset to the supplier instead (Fixed asset → Dispose → supplier credit).`,
        );
      }
      const samePricing =
        Number(returnLine.unitPrice) === Number(line.unitPrice) &&
        Number(returnLine.discountPercent ?? 0) ===
          Number(line.discountPercent) &&
        Number(returnLine.discountValue ?? 0) === Number(line.discountValue) &&
        (returnLine.taxId ?? null) === (line.taxId ?? null);
      if (!samePricing) {
        throw new BadRequestException(
          `A fixed asset line is returned at its invoiced price, discount and tax — they cannot be changed on the return.`,
        );
      }
      await this.fixedAssets.assertLineReturnable(
        line.fixedAsset,
        {
          invoicedQuantity: line.quantity,
          returnedQuantity: returnLine.quantity,
        },
        client,
      );
      return;
    }
    this.prepaidExpenses.assertReturnable(
      line.prepaidExpense,
      this.returnedBaseAmount(line, returnLine),
    );
  }

  /** Base-currency amount a returned prepaid line reclaims (at the invoice's rate). */
  private returnedBaseAmount(
    line: TreatedInvoiceLine,
    returnLine: ReturnLineValues,
  ): number {
    const rate =
      line.purchaseInvoice.exchangeRate != null
        ? Number(line.purchaseInvoice.exchangeRate)
        : 1;
    const net = round2(
      Number(returnLine.lineTotal) - Number(returnLine.taxAmount ?? 0),
    );
    return round2(net * rate);
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
          partner: true,
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
        `Purchase Return ${purchaseReturn.returnNumber} ${verb}`,
        undefined,
        tx,
      );
      return updated;
    });
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

  /** TASK-048 — the return's partner must match its source invoice's partner; the invoice must exist and not be deleted. */
  private async assertSourceInvoice(
    purchaseInvoiceId: string,
    partnerId: string,
  ) {
    const invoice = await this.prisma.purchaseInvoice.findFirst({
      where: { id: purchaseInvoiceId, deletedAt: null },
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
      throw new NotFoundException(
        `Purchase Invoice ${purchaseInvoiceId} not found`,
      );
    }
    if (invoice.partnerId !== partnerId) {
      throw new BadRequestException(
        'Purchase Return partner must match the source Purchase Invoice partner.',
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
    await assertNoKitProducts(
      this.prisma,
      items.map((item) => item.productId),
    );
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
        taxId: taxIds[index],
        purchaseInvoiceItemId: item.purchaseInvoiceItemId,
        taxAmount: computedLines[index].taxAmount,
        lineTotal: computedLines[index].lineTotal,
        notes: item.notes,
      }));

    const totals = computeSalesDocumentTotals(computedLines);

    return { lines, totals };
  }
}
