import type { ResolvedStockLine } from '../../inventory/stock-lines/stock-line-resolver';
import { parseTransitKey } from './stock-ledger';

/** The ledger facts a dispatch movement carries (see `transitKeyBase`). */
export interface CompositionMovement {
  productId: string;
  quantity: number;
  idempotencyKey: string | null;
  parentProductId: string | null;
  recipeId: string | null;
}

/** A dispatched shipment line, oldest attempt first. */
export interface CompositionLine {
  id: string;
  quantity: number;
  /** Units carried over from `carriedFrom` (a reship) — not transferred by this line. */
  carried: number;
  /** The previous attempt's line of the same order line, when this one carried from it. */
  carriedFrom: string | null;
}

/** ONE unit of an order line as it went into transit (a kit: its components). */
export type UnitComposition = Array<
  Pick<
    ResolvedStockLine,
    'productId' | 'quantity' | 'parentProductId' | 'recipeId'
  >
>;

/**
 * R15 (review M4) — what one unit of each dispatched shipment line put into
 * the goods-in-transit warehouse, read from its own dispatch movements
 * (`STORE_ORDER_TRANSIT:<shipmentLine>…:IN`): a kit unit is the components of
 * the recipe it was dispatched with, whatever the recipe says today. A
 * carried unit keeps the composition of the attempt it came from. A line
 * whose dispatch cannot be read back (nothing transferred, uneven split) is
 * absent — the caller falls back to resolving the product.
 */
export function dispatchedUnits(
  movements: CompositionMovement[],
  lines: CompositionLine[],
): Map<string, UnitComposition> {
  const inByLine = new Map<string, Map<string, CompositionMovement>>();
  for (const movement of movements) {
    const parsed = parseTransitKey(movement.idempotencyKey);
    if (
      !parsed ||
      parsed.back ||
      movement.quantity <= 0 ||
      !movement.idempotencyKey?.endsWith(':IN')
    ) {
      continue;
    }
    const perProduct =
      inByLine.get(parsed.shipmentLineId) ??
      new Map<string, CompositionMovement>();
    const seen = perProduct.get(movement.productId);
    perProduct.set(movement.productId, {
      ...movement,
      quantity: (seen?.quantity ?? 0) + movement.quantity,
    });
    inByLine.set(parsed.shipmentLineId, perProduct);
  }

  const result = new Map<string, UnitComposition>();
  for (const line of lines) {
    const fresh = line.quantity - line.carried;
    const transferred = inByLine.get(line.id);
    if (fresh > 0 && transferred) {
      const unit = [...transferred.values()].map((movement) => ({
        productId: movement.productId,
        quantity: movement.quantity / fresh,
        ...(movement.parentProductId
          ? {
              parentProductId: movement.parentProductId,
              recipeId: movement.recipeId ?? undefined,
            }
          : {}),
      }));
      if (unit.every((component) => Number.isInteger(component.quantity))) {
        result.set(line.id, unit);
      }
      continue;
    }
    const inherited = line.carriedFrom ? result.get(line.carriedFrom) : null;
    if (fresh <= 0 && inherited) result.set(line.id, inherited);
  }
  return result;
}

/** Same components and quantities (order-insensitive) — a reship never mixes two kit compositions. */
export function sameComposition(a: UnitComposition, b: UnitComposition) {
  const key = (unit: UnitComposition) =>
    unit
      .map((line) => `${line.productId}×${line.quantity}`)
      .sort()
      .join('|');
  return key(a) === key(b);
}
