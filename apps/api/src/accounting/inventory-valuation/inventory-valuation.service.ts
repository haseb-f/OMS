import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import { InventoryMovementType, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

const RESERVATION_TYPES: InventoryMovementType[] = [
  InventoryMovementType.RESERVATION,
  InventoryMovementType.RESERVATION_RELEASE,
];

type DecimalInput = Prisma.Decimal | string | number;
const D = (value: DecimalInput) => new Prisma.Decimal(value);
const ZERO = D(0);

/** Unit cost / average cost precision — `Decimal(14,4)` columns (R13 spec §4). */
export const round4 = (value: DecimalInput) =>
  D(value).toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP);
/** GL amount precision — every journal amount is rounded to 2 dp per line. */
export const round2 = (value: DecimalInput) =>
  D(value).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);

/**
 * Moving-average blend: the stock already held (`onHandBefore` units at
 * `previousCost`) plus `addedQuantity` units worth `addedValue` in total.
 *
 *   newAverage = (onHandBefore × previousCost + addedValue) / (onHandBefore + addedQuantity)
 *
 * Nothing (or less) on hand before the addition means the added units ARE
 * the whole pool, so the average is simply `addedValue / addedQuantity`.
 * Blending the TOTAL value (not a rounded unit cost) keeps the value exact;
 * only the stored average is rounded, to 4 dp.
 */
export function blendMovingAverage(input: {
  onHandBefore: number;
  previousCost: DecimalInput;
  addedQuantity: number;
  addedValue: DecimalInput;
}): Prisma.Decimal {
  const { onHandBefore, addedQuantity } = input;
  const addedValue = D(input.addedValue);
  if (addedQuantity <= 0) return round4(input.previousCost);
  if (onHandBefore <= 0) return round4(addedValue.div(addedQuantity));
  return round4(
    D(input.previousCost)
      .mul(onHandBefore)
      .add(addedValue)
      .div(onHandBefore + addedQuantity),
  );
}

/**
 * Landed cost after receipt (R13 spec §4, Odoo AVCO behaviour adapted): of an
 * allocated amount `A` for `Q` received units, only the units still in stock
 * (`min(Q, O)`) can be capitalized into inventory; the share that belongs to
 * units already sold is a variance that the caller expenses to COGS.
 *
 *   capitalized = round2(A × min(Q, O) / Q)        variance = A − capitalized
 *
 * `O ≤ 0` ⇒ everything is variance (never an error).
 */
export function splitLandedCost(input: {
  allocatedAmount: DecimalInput;
  allocatedQuantity: number;
  onHand: number;
}): { capitalized: Prisma.Decimal; variance: Prisma.Decimal } {
  const amount = round2(input.allocatedAmount);
  const { allocatedQuantity, onHand } = input;
  if (allocatedQuantity <= 0) {
    throw new UnprocessableEntityException({
      code: 'LANDED_COST_QUANTITY_INVALID',
      message: 'A landed cost allocation needs a positive received quantity.',
    });
  }
  if (onHand <= 0) return { capitalized: ZERO, variance: amount };
  const capitalized = round2(
    amount.mul(Math.min(allocatedQuantity, onHand)).div(allocatedQuantity),
  );
  return { capitalized, variance: amount.sub(capitalized) };
}

/**
 * One received line: `quantity` units worth `value` in total (functional
 * currency) — or, for callers that only know a unit cost, `quantity × unitCost`.
 * `value` wins when given: it is exactly what the journal books for the line,
 * so the pool never drifts from the GL by a rounded unit cost × quantity.
 */
type ReceiptLine =
  | { quantity: number; unitCost: DecimalInput; value?: undefined }
  | { quantity: number; value: DecimalInput; unitCost?: undefined };

/**
 * Inventory Valuation Service (TASK-046) — the ONLY place that knows how a
 * product's inventory cost is calculated. The Posting Engine and every
 * Posting Provider only ever receive a plain number from this service; they
 * never see quantities, movements, or costing methods.
 *
 * Reads/writes `Product.currentCost` / `ProductCostSnapshot` /
 * `ProductCostHistory` directly via Prisma (never through
 * `ProductCostService`, whose `recordCost()` opens its own transaction and
 * can't participate in the Posting Engine's) — same "read via raw Prisma to
 * avoid cross-module coupling and preserve one atomic transaction" pattern
 * `FinancialTransactionsService` already uses for Sales/Purchase Invoices.
 *
 * Current scope: a single moving-average cost per product (mirrors
 * `Product.costingMethod = AVERAGE`, the only method this codebase actually
 * computes today — ADR-0014 explicitly deferred FIFO/Standard Cost
 * calculation to later work, and this task does not implement them either).
 * Cost columns are `Decimal(14,4)` (R13): every average is computed with
 * `Prisma.Decimal` and stored rounded to 4 dp — never a JS float, never a
 * 2 dp rounding of the unit cost (only GL amounts are 2 dp).
 */
@Injectable()
export class InventoryValuationService {
  constructor(private readonly prisma: PrismaService) {}

  /** The exact current moving average (4 dp) — 0 for a product with no cost recorded yet. */
  async getUnitCostDecimal(
    productId: string,
    tx: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<Prisma.Decimal> {
    const product = await tx.product.findUnique({
      where: { id: productId },
      select: { currentCost: true },
    });
    return D(product?.currentCost ?? 0);
  }

  /** The unit cost to use for a COGS posting — falls back to 0 for a product with no cost recorded yet. */
  async getUnitCost(
    productId: string,
    tx: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<number> {
    return (await this.getUnitCostDecimal(productId, tx)).toNumber();
  }

  /** On-hand across every warehouse (the reserved ledger excluded). */
  async getOnHandQuantity(
    tx: Prisma.TransactionClient | PrismaService,
    productId: string,
  ): Promise<number> {
    const result = await tx.inventoryMovement.aggregate({
      where: { productId, type: { notIn: RESERVATION_TYPES } },
      _sum: { quantity: true },
    });
    return result._sum.quantity ?? 0;
  }

  /**
   * Company stock value — Σ onHand × moving average over COMPANY-owned
   * movements only (`ownerAgentId` null). Agent-owned stock is never a company
   * asset and never reaches this figure (R13 spec §5/§8 I7). Value per product
   * is rounded to 2 dp (the GL precision); the total is the sum of those.
   */
  async getCompanyStockValue(
    tx: Prisma.TransactionClient | PrismaService = this.prisma,
    filter: { warehouseId?: string; productIds?: string[] } = {},
  ): Promise<{
    totalValue: Prisma.Decimal;
    items: {
      productId: string;
      onHand: number;
      unitCost: Prisma.Decimal;
      value: Prisma.Decimal;
    }[];
  }> {
    const groups = await tx.inventoryMovement.groupBy({
      by: ['productId'],
      where: {
        ownerAgentId: null,
        type: { notIn: RESERVATION_TYPES },
        warehouseId: filter.warehouseId,
        productId: filter.productIds ? { in: filter.productIds } : undefined,
      },
      _sum: { quantity: true },
    });
    const held = groups.filter((group) => (group._sum.quantity ?? 0) !== 0);
    if (held.length === 0) return { totalValue: ZERO, items: [] };
    const products = await tx.product.findMany({
      where: { id: { in: held.map((group) => group.productId) } },
      select: { id: true, currentCost: true },
    });
    const costById = new Map(
      products.map((p) => [p.id, D(p.currentCost ?? 0)]),
    );
    const items = held.map((group) => {
      const onHand = group._sum.quantity ?? 0;
      const unitCost = costById.get(group.productId) ?? ZERO;
      return {
        productId: group.productId,
        onHand,
        unitCost,
        value: round2(unitCost.mul(onHand)),
      };
    });
    return {
      totalValue: items.reduce((sum, item) => sum.add(item.value), ZERO),
      items,
    };
  }

  /**
   * Recomputes the moving-average cost after receiving `receivedQuantity`
   * units at `unitCost` (e.g. a Purchase Invoice line) and persists it —
   * this is what keeps "Inventory value must always stay updated" true.
   * Must run inside the caller's transaction so the new cost commits
   * atomically with the Purchase Invoice's own Posting Engine entry.
   *
   * `onHandBefore` is the on-hand BEFORE the whole document. Left out, it is
   * derived as `current on-hand − receivedQuantity` (correct only when this is
   * the document's single line for the product — for several lines of the same
   * product use `applyPurchaseReceiptLines`).
   */
  async applyPurchaseReceipt(
    productId: string,
    receivedQuantity: number,
    unitCost: number,
    tx: Prisma.TransactionClient,
    userId?: string,
    onHandBefore?: number,
  ): Promise<{ previousCost: number; newCost: number }> {
    return this.applyPurchaseReceiptLines(
      productId,
      [{ quantity: receivedQuantity, unitCost }],
      tx,
      userId,
      onHandBefore,
    );
  }

  /**
   * One document, several lines of the SAME product (purchase invoice): the
   * blend must use the on-hand before the whole document, so the lines are
   * blended together — `(onHandBefore × avg + Σ qty × cost) / (onHandBefore + Σ qty)`
   * — in one cost update and one history row. Blending line by line against
   * the on-hand that already contains the other lines is exactly the bug this
   * replaces. `onHandBefore` defaults to `current on-hand − Σ qty` (the
   * movements of the document are already posted when valuation runs).
   */
  async applyPurchaseReceiptLines(
    productId: string,
    lines: ReceiptLine[],
    tx: Prisma.TransactionClient,
    userId?: string,
    onHandBefore?: number,
  ): Promise<{ previousCost: number; newCost: number }> {
    return this.blendReceiptLines(
      productId,
      lines,
      tx,
      userId,
      onHandBefore,
      'Purchase receipt — moving average recalculated',
      'PURCHASE_INVOICE',
    );
  }

  /**
   * Sales Return valuation counterpart of `applyPurchaseReceipt` — same
   * "add quantity at a known unit cost, reweight the average" formula, but
   * the unit cost is never a fresh purchase price: it is the ORIGINAL
   * sale's historical unit cost (`SalesInvoiceItem.unitCost`, the same
   * snapshot `SalesReturnPostingProvider` already replays for the COGS/
   * Inventory journal reversal), so the accounting reversal and the
   * valuation pool stay consistent with each other. Must run after the
   * physical `postSalesReturn` movement inside the same transaction —
   * mirrors `applyPurchaseReceipt`'s own ordering requirement.
   */
  async applyReturnToStock(
    productId: string,
    returnedQuantity: number,
    historicalUnitCost: number,
    tx: Prisma.TransactionClient,
    userId?: string,
    onHandBefore?: number,
  ): Promise<{ previousCost: number; newCost: number }> {
    return this.applyReturnToStockLines(
      productId,
      [{ quantity: returnedQuantity, unitCost: historicalUnitCost }],
      tx,
      userId,
      onHandBefore,
    );
  }

  /** Several return lines of the same product in one document — see `applyPurchaseReceiptLines`. */
  async applyReturnToStockLines(
    productId: string,
    lines: ReceiptLine[],
    tx: Prisma.TransactionClient,
    userId?: string,
    onHandBefore?: number,
  ): Promise<{ previousCost: number; newCost: number }> {
    return this.blendReceiptLines(
      productId,
      lines,
      tx,
      userId,
      onHandBefore,
      'Sales return — moving average recalculated',
      'SALES_RETURN',
    );
  }

  private async blendReceiptLines(
    productId: string,
    lines: ReceiptLine[],
    tx: Prisma.TransactionClient,
    userId: string | undefined,
    onHandBeforeDocument: number | undefined,
    reason: string,
    referenceType: string,
  ): Promise<{ previousCost: number; newCost: number }> {
    const addedQuantity = lines.reduce((sum, line) => sum + line.quantity, 0);
    const addedValue = lines.reduce(
      (sum, line) =>
        sum.add(
          line.value !== undefined
            ? D(line.value)
            : D(line.unitCost).mul(line.quantity),
        ),
      ZERO,
    );
    const [onHandNow, previousCost] = await Promise.all([
      onHandBeforeDocument === undefined
        ? this.getOnHandQuantity(tx, productId)
        : Promise.resolve(0),
      this.getStoredCost(tx, productId),
    ]);
    const onHandBefore = onHandBeforeDocument ?? onHandNow - addedQuantity;
    const newCost = blendMovingAverage({
      onHandBefore,
      previousCost,
      addedQuantity,
      addedValue,
    });
    await this.persistCost(tx, {
      productId,
      previousCost,
      newCost,
      reason,
      referenceType,
      userId,
    });
    return {
      previousCost: previousCost.toNumber(),
      newCost: newCost.toNumber(),
    };
  }

  /**
   * ADR-0017 (Cost Engine M1) + R13 spec §4 — capitalizes a Landed Cost
   * allocation into inventory value *after* the original receipt already
   * averaged in without it (a freight/customs invoice that arrives days or
   * weeks after the goods).
   *
   * Only the units still in stock can carry the cost: given the allocated
   * amount `A` for `Q` received units and the current on-hand `O`,
   * `capitalized = round2(A × min(Q, O) / Q)` raises the average by
   * `capitalized / O` (only when `O > 0`) and `variance = A − capitalized`
   * belongs to units already sold — the caller books it to COGS (landed-cost
   * variance). `O ≤ 0` ⇒ the whole amount is variance and nothing moves; this
   * never throws on an empty balance.
   *
   * `allocatedQuantity` omitted ⇒ legacy behaviour: the amount is treated as
   * belonging to the stock currently on hand (`Q = O`, all capitalized) —
   * callers that know the allocated receipt quantity must pass it.
   */
  async applyLandedCost(
    productId: string,
    allocatedAmount: DecimalInput,
    tx: Prisma.TransactionClient,
    userId?: string,
    options: { allocatedQuantity?: number; referenceId?: string } = {},
  ): Promise<{
    previousCost: number;
    newCost: number;
    onHandQuantity: number;
    capitalized: number;
    variance: number;
  }> {
    const [onHandQuantity, previousCost] = await Promise.all([
      this.getOnHandQuantity(tx, productId),
      this.getStoredCost(tx, productId),
    ]);
    const { capitalized, variance } = splitLandedCost({
      allocatedAmount,
      allocatedQuantity:
        options.allocatedQuantity ?? Math.max(onHandQuantity, 1),
      onHand: onHandQuantity,
    });

    let newCost = previousCost;
    if (onHandQuantity > 0 && capitalized.gt(0)) {
      newCost = round4(previousCost.add(capitalized.div(onHandQuantity)));
      await this.persistCost(tx, {
        productId,
        previousCost,
        newCost,
        reason: 'Landed cost capitalized — moving average recalculated',
        referenceType: 'LANDED_COST',
        referenceId: options.referenceId,
        userId,
      });
    }

    return {
      previousCost: previousCost.toNumber(),
      newCost: newCost.toNumber(),
      onHandQuantity,
      capitalized: capitalized.toNumber(),
      variance: variance.toNumber(),
    };
  }

  /**
   * Finished item of an assembly order — blends the TOTAL value of the batch
   * (components consumed + direct cost, 2 dp) into the moving average:
   *
   *   newAverage = (onHandBefore × previousCost + totalValue) / (onHandBefore + quantityReceived)
   *
   * so the inventory value rises by exactly `totalValue`. `onHandBefore` is the
   * product's on-hand before the output movement. `unitCost` (total ÷ quantity,
   * 4 dp) is what the order records as the finished unit cost. Writes the cost
   * snapshot + a history row (`ASSEMBLY_ORDER`).
   */
  async applyAssemblyOutput(
    tx: Prisma.TransactionClient,
    input: {
      productId: string;
      quantityReceived: number;
      totalValue: DecimalInput;
      referenceId: string;
      onHandBefore: number;
      userId?: string;
    },
  ): Promise<{ previousCost: number; newCost: number; unitCost: number }> {
    const totalValue = round2(input.totalValue);
    const previousCost = await this.getStoredCost(tx, input.productId);
    const newCost = blendMovingAverage({
      onHandBefore: input.onHandBefore,
      previousCost,
      addedQuantity: input.quantityReceived,
      addedValue: totalValue,
    });
    await this.persistCost(tx, {
      productId: input.productId,
      previousCost,
      newCost,
      reason: 'Assembly output — moving average recalculated',
      referenceType: 'ASSEMBLY_ORDER',
      referenceId: input.referenceId,
      userId: input.userId,
    });
    return {
      previousCost: previousCost.toNumber(),
      newCost: newCost.toNumber(),
      unitCost: round4(totalValue.div(input.quantityReceived)).toNumber(),
    };
  }

  /**
   * Reversal of an assembly's finished item (R13 M3 decision): the units leave
   * the pool at the CURRENT moving average, so the average of what remains is
   * unchanged and the sub-ledger value drops by exactly
   * `removedValue = round2(quantityRemoved × average)`. When the average moved
   * since the assembly, the gap to the order's recorded total is booked by the
   * caller as a separate variance entry (Posting Engine), so the GL relieves
   * the same value. Nothing is persisted (the average does not change).
   */
  async applyAssemblyReversal(
    tx: Prisma.TransactionClient,
    input: { productId: string; quantityRemoved: number },
  ): Promise<{ unitCost: Prisma.Decimal; removedValue: Prisma.Decimal }> {
    const unitCost = round4(await this.getStoredCost(tx, input.productId));
    return {
      unitCost,
      removedValue: round2(unitCost.mul(input.quantityRemoved)),
    };
  }

  /**
   * The recorded moving average per product — `null` when no cost was ever
   * recorded (as opposed to a recorded cost of 0). Callers that must never
   * value stock at a silent zero (assembly consumption) block on `null`.
   */
  async getRecordedUnitCosts(
    tx: Prisma.TransactionClient | PrismaService,
    productIds: string[],
  ): Promise<Map<string, Prisma.Decimal | null>> {
    const products = await tx.product.findMany({
      where: { id: { in: [...new Set(productIds)] } },
      select: { id: true, currentCost: true },
    });
    return new Map(
      products.map((product) => [
        product.id,
        product.currentCost == null ? null : D(product.currentCost),
      ]),
    );
  }

  private async getStoredCost(
    tx: Prisma.TransactionClient,
    productId: string,
  ): Promise<Prisma.Decimal> {
    const product = await tx.product.findUniqueOrThrow({
      where: { id: productId },
      select: { currentCost: true },
    });
    return D(product.currentCost ?? 0);
  }

  /** The one write path of the moving average: product mirror + snapshot + history row. */
  private async persistCost(
    tx: Prisma.TransactionClient,
    input: {
      productId: string;
      previousCost: Prisma.Decimal;
      newCost: Prisma.Decimal;
      reason: string;
      referenceType: string;
      referenceId?: string;
      userId?: string;
    },
  ): Promise<void> {
    const { productId, previousCost, newCost, userId } = input;
    await tx.product.update({
      where: { id: productId },
      data: { currentCost: newCost, lastCostUpdate: new Date() },
    });
    await tx.productCostSnapshot.upsert({
      where: { productId },
      create: { productId, cost: newCost, createdBy: userId ?? null },
      update: { cost: newCost, updatedBy: userId ?? null },
    });
    await tx.productCostHistory.create({
      data: {
        productId,
        previousCost,
        newCost,
        reason: input.reason,
        referenceType: input.referenceType,
        referenceId: input.referenceId ?? null,
        createdBy: userId ?? null,
      },
    });
  }
}
