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
