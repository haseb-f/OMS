/**
 * Inventory cost visibility (R9 release review) — the web mirror of the API rule in
 * `apps/api/src/inventory/inventory-cost-visibility.ts`: movement unit cost and the
 * average cost / last cost / stock value of a stock card are company-wide valuation
 * numbers, returned only to a caller holding an existing costing permission
 * (`expenses.view` — Product Cost, or `cost-explorer.view`), or a super admin. The API
 * withholds the values (`null`); these helpers also remove the cost COLUMNS (and with
 * them their export columns) so a table never shows a column of dashes, and a Grid card
 * drops a cost field whose value is empty. Same data, same rule, both views.
 */
export const INVENTORY_COST_PERMISSIONS = ["expenses.view", "cost-explorer.view"] as const;

export const INVENTORY_COST_COLUMN_IDS: ReadonlySet<string> = new Set([
  "unitCost",
  "runningCost",
  "averageCost",
  "lastCost",
  "stockValue",
]);

/** \`hasPermission\` from the user context already treats a super admin as holding every key. */
export function canViewInventoryCost(hasPermission: (permission: string) => boolean): boolean {
  return INVENTORY_COST_PERMISSIONS.some((permission) => hasPermission(permission));
}

export function omitInventoryCostColumns<T extends { id?: string }>(
  columns: T[],
  canViewCost: boolean,
): T[] {
  return canViewCost
    ? columns
    : columns.filter((column) => !(column.id && INVENTORY_COST_COLUMN_IDS.has(column.id)));
}
