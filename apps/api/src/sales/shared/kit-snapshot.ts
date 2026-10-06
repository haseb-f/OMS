import { InventoryMovementType, Prisma } from '@prisma/client';
import {
  round2,
  round4,
} from '../../accounting/inventory-valuation/inventory-valuation.service';
import type { KitSnapshot } from '../../inventory/stock-lines/stock-line-resolver';

/**
 * R13 (spec §3B / §4 "Kit COGS") — the recipe snapshot a kit sale line keeps in
 * `SalesInvoiceItem.fulfillmentSnapshot`: the recipe version that exploded the
 * kit and, per component, the quantity per kit and the moving-average cost the
 * COGS was booked at. Written once when the line is delivered; a return of the
 * line replays it (never the current recipe or the current cost).
 */
export type KitFulfillmentSnapshot = KitSnapshot;

/** The JSON stored on the invoice line (plain data, decimal strings). */
export function kitSnapshotJson(
  snapshot: KitFulfillmentSnapshot,
): Prisma.InputJsonObject {
  return {
    recipeId: snapshot.recipeId,
    version: snapshot.version,
    components: snapshot.components.map((component) => ({
      productId: component.productId,
      qtyPerKit: component.qtyPerKit,
      unitCost: component.unitCost,
    })),
  };
}

/**
 * Reads a stored snapshot back; `null` when the line has none (a plain or
 * service line). A malformed snapshot is a data error and fails loudly — a kit
 * line must never post or return without its components.
 */
export function readKitSnapshot(
  value: Prisma.JsonValue | null | undefined,
): KitFulfillmentSnapshot | null {
  if (value == null) return null;
  const raw = value as {
    recipeId?: unknown;
    version?: unknown;
    components?: unknown;
  };
  const components = Array.isArray(raw.components)
    ? (raw.components as Array<Record<string, unknown>>)
    : null;
  if (
    typeof raw.recipeId !== 'string' ||
    typeof raw.version !== 'number' ||
    !components ||
    components.length === 0 ||
    components.some(
      (c) =>
        typeof c.productId !== 'string' ||
        typeof c.qtyPerKit !== 'number' ||
        !Number.isInteger(c.qtyPerKit) ||
        c.qtyPerKit <= 0 ||
        (typeof c.unitCost !== 'string' && typeof c.unitCost !== 'number'),
    )
  ) {
    throw new Error('Invalid kit fulfillment snapshot on a sales line.');
  }
  return {
    recipeId: raw.recipeId,
    version: raw.version,
    components: components.map((c) => ({
      productId: c.productId as string,
      qtyPerKit: c.qtyPerKit as number,
      unitCost: String(c.unitCost),
    })),
  };
}

/** Kit unit cost = Σ qtyPerKit × component unit cost (4 dp) — what the line's `unitCost` records. */
export function kitUnitCost(snapshot: KitFulfillmentSnapshot): Prisma.Decimal {
  return round4(
    snapshot.components.reduce(
      (sum, component) =>
        sum.add(
          new Prisma.Decimal(component.unitCost).mul(component.qtyPerKit),
        ),
      new Prisma.Decimal(0),
    ),
  );
}

/**
 * GL value of one component of `kitQuantity` kits:
 * round2(qtyPerKit × kitQuantity × unitCost). The kit line's COGS is the sum of
 * these (recognised once — the kit itself carries no stock cost).
 */
export function kitComponentValue(
  component: KitFulfillmentSnapshot['components'][number],
  kitQuantity: number,
): Prisma.Decimal {
  return round2(
    new Prisma.Decimal(component.unitCost).mul(
      component.qtyPerKit * kitQuantity,
    ),
  );
}

/**
 * R13 — a historical sale line is decided by what happened to it, never by the
 * product's CURRENT supply method (a product sold as a stocked item may have
 * been switched to KIT once its stock ran out). A line without a kit snapshot
 * whose own product was delivered from stock under its invoice (a
 * `SALES_DELIVERY` of the product itself — not as a kit component) was a
 * plain stocked line. Returns the `invoiceId:productId` pairs for which such a
 * delivery exists (one query).
 */
export async function productsDeliveredThemselves(
  tx: Pick<Prisma.TransactionClient, 'inventoryMovement'>,
  lines: { salesInvoiceId: string; productId: string }[],
): Promise<Set<string>> {
  if (lines.length === 0) return new Set();
  const movements = await tx.inventoryMovement.findMany({
    where: {
      type: InventoryMovementType.SALES_DELIVERY,
      referenceType: 'SALES_INVOICE',
      referenceId: { in: [...new Set(lines.map((l) => l.salesInvoiceId))] },
      productId: { in: [...new Set(lines.map((l) => l.productId))] },
      parentProductId: null,
    },
    select: { referenceId: true, productId: true },
  });
  return new Set(
    movements.map((m) => deliveredKey(m.referenceId ?? '', m.productId)),
  );
}

export const deliveredKey = (salesInvoiceId: string, productId: string) =>
  `${salesInvoiceId}:${productId}`;
