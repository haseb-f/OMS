import type {
  LandedCostAllocationRow,
  LandedCostDocumentRow,
} from "@/services/landed-cost-service";

/**
 * R13 landed cost posting split (spec §4): per allocated invoice line, the part
 * for units still on hand is CAPITALIZED into inventory (moves the average) and
 * the part for units already sold is charged to COGS as landed-cost VARIANCE.
 * Pure, unit-tested in `landed-cost-split.spec.ts`.
 */

/** Cents of a decimal string / number (avoids float drift when summing money). */
function toCents(value: string | number | null | undefined): number {
  if (value === null || value === undefined || value === "") return 0;
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? Math.round(number * 100) : 0;
}

/** True once the posting recorded the split on at least one allocation. */
export function hasPostedSplit(allocations: readonly LandedCostAllocationRow[]): boolean {
  return allocations.some(
    (allocation) =>
      allocation.capitalizedAmount !== null && allocation.capitalizedAmount !== undefined,
  );
}

export interface PostedSplitTotals {
  allocated: number;
  capitalized: number;
  variance: number;
}

export function postedSplitTotals(
  allocations: readonly LandedCostAllocationRow[],
): PostedSplitTotals {
  let allocated = 0;
  let capitalized = 0;
  let variance = 0;
  for (const allocation of allocations) {
    allocated += toCents(allocation.allocatedAmount);
    capitalized += toCents(allocation.capitalizedAmount);
    variance += toCents(allocation.cogsVarianceAmount);
  }
  return { allocated: allocated / 100, capitalized: capitalized / 100, variance: variance / 100 };
}

/** The frozen document rate as a number, or null when the document carries none. */
export function frozenExchangeRate(
  document: Pick<LandedCostDocumentRow, "exchangeRate">,
): number | null {
  const rate = document.exchangeRate;
  if (rate === null || rate === undefined || rate === "") return null;
  const number = typeof rate === "number" ? rate : Number(rate);
  return Number.isFinite(number) && number > 0 ? number : null;
}
