/**
 * Inventory cost visibility (R9 release review).
 *
 * Unit cost on a movement, and the average cost / last cost / stock value of a stock
 * card, are company-wide valuation numbers. The permission catalog already treats them
 * as the sensitive ones (`cost-explorer` / Product Cost: "company-wide inventory
 * valuation … more sensitive than the Cost Category vocabulary list"), so they are
 * returned only to a caller who holds one of the existing costing permissions — or is a
 * super admin. Everyone else with `inventory.view` still gets quantities, references and
 * dates; the cost fields come back `null` (the web hides the columns and card fields).
 * No new permission and no new policy: the two keys below already exist and already gate
 * the Product Cost and Cost Explorer screens.
 */
export const INVENTORY_COST_PERMISSIONS = [
  'expenses.view',
  'cost-explorer.view',
] as const;

type WithUnitCost = { unitCost?: unknown };
type WithStockCost = {
  averageCost?: unknown;
  lastCost?: unknown;
  stockValue?: unknown;
};

/** A movement row with its cost withheld (all other fields untouched). */
export function redactMovementCost<T extends WithUnitCost>(movement: T): T {
  if (movement.unitCost === undefined) return movement;
  return { ...movement, unitCost: null };
}

/** A stock card with its valuation withheld (quantities untouched). */
export function redactStockCardCost<T extends WithStockCost>(card: T): T {
  return { ...card, averageCost: null, lastCost: null, stockValue: null };
}

type WithLineCost = WithUnitCost & {
  fulfillmentSnapshot?: unknown;
  product?: unknown;
};

/**
 * A document line (e.g. a sales invoice item) with its cost withheld: the line's
 * `unitCost` (COGS snapshot), every kit component's snapshot `unitCost` (R13 —
 * `productId` / `qtyPerKit` stay) and the embedded product's moving average
 * (`currentCost`). Prices, quantities and totals are untouched.
 */
export function redactLineCost<T extends WithLineCost>(line: T): T {
  const out: WithLineCost = redactMovementCost(line);
  const snapshot = line.fulfillmentSnapshot;
  if (
    snapshot &&
    typeof snapshot === 'object' &&
    Array.isArray((snapshot as { components?: unknown }).components)
  ) {
    const components = (snapshot as { components: unknown[] }).components;
    out.fulfillmentSnapshot = {
      ...snapshot,
      components: components.map((component) => {
        if (!component || typeof component !== 'object') return component;
        const rest: Record<string, unknown> = { ...component };
        delete rest.unitCost;
        return rest;
      }),
    };
  }
  const product = line.product;
  if (product && typeof product === 'object' && 'currentCost' in product) {
    out.product = { ...product, currentCost: null };
  }
  return out as T;
}

/** A document (header + `items`) with every line's cost withheld. */
export function redactDocumentLinesCost<T extends { items?: unknown }>(
  document: T,
): T {
  if (!Array.isArray(document.items)) return document;
  return {
    ...document,
    items: (document.items as WithLineCost[]).map(redactLineCost),
  };
}
