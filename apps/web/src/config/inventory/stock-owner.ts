import type { StockOwnerFields, StockOwnerQuery } from "@/services/inventory-service";

/**
 * R13 owner-aware stock (spec §5, api-contract §5): physical stock may belong to
 * the company or to an agent. Stock screens show the owner on every row and
 * filter by it; valuation totals count COMPANY-owned stock only (agent stock is
 * never a company asset — the API already returns `stockValue: null` for it).
 * Pure helpers, unit-tested in `stock-owner.spec.ts`.
 */

/** The list filter's values: "" = all owners. */
export type StockOwnerFilter = "" | "COMPANY" | "AGENT";

export const STOCK_OWNER_FILTERS: Exclude<StockOwnerFilter, "">[] = ["COMPANY", "AGENT"];

/** The `owner` query for a filter value — undefined (no filter) for "all" or anything unknown. */
export function stockOwnerQuery(filter: string): StockOwnerQuery | undefined {
  return filter === "COMPANY" || filter === "AGENT" ? filter : undefined;
}

export function isCompanyOwned(row: Partial<StockOwnerFields>): boolean {
  return !row.ownerAgentId;
}

/** "Company" for company stock, the agent's name otherwise (the agent id is never shown as a name). */
export function stockOwnerLabel(
  row: Partial<StockOwnerFields>,
  labels: { company: string; unknownAgent: string },
): string {
  if (isCompanyOwned(row)) return labels.company;
  return row.ownerAgentName?.trim() || labels.unknownAgent;
}

/**
 * Total stock value of COMPANY-owned rows (2 dp). Agent-owned rows never count,
 * even if a value was somehow present; a row without a value (cost not visible
 * or unknown) adds nothing. Returns null when no row carries a value at all.
 */
export function companyStockValueTotal(
  rows: (Partial<StockOwnerFields> & { stockValue: number | null })[],
): number | null {
  let total = 0;
  let counted = false;
  for (const row of rows) {
    if (!isCompanyOwned(row) || row.stockValue === null || !Number.isFinite(row.stockValue)) {
      continue;
    }
    total += row.stockValue;
    counted = true;
  }
  return counted ? Math.round(total * 100) / 100 : null;
}
