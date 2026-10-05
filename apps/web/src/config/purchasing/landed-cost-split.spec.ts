import { describe, expect, it } from "vitest";
import type { LandedCostAllocationRow } from "@/services/landed-cost-service";
import { frozenExchangeRate, hasPostedSplit, postedSplitTotals } from "./landed-cost-split";

const allocation = (
  id: string,
  allocatedAmount: string,
  capitalizedAmount?: string | null,
  cogsVarianceAmount?: string | null,
): LandedCostAllocationRow => ({
  id,
  purchaseInvoiceItemId: `item-${id}`,
  allocatedQuantity: 10,
  allocatedAmount,
  capitalizedAmount,
  cogsVarianceAmount,
});

describe("landed cost posted split", () => {
  it("is present only once the posting recorded it", () => {
    expect(hasPostedSplit([allocation("1", "100.00")])).toBe(false);
    expect(hasPostedSplit([allocation("1", "100.00", null, null)])).toBe(false);
    expect(hasPostedSplit([allocation("1", "100.00", "60.00", "40.00")])).toBe(true);
  });

  it("totals allocated = capitalized + variance, without float drift", () => {
    const totals = postedSplitTotals([
      allocation("1", "100.10", "60.05", "40.05"),
      allocation("2", "0.20", "0.20", "0.00"),
    ]);
    expect(totals).toEqual({ allocated: 100.3, capitalized: 60.25, variance: 40.05 });
    expect(totals.capitalized + totals.variance).toBeCloseTo(totals.allocated, 10);
  });

  it("reads the frozen exchange rate, ignoring a missing or invalid one", () => {
    expect(frozenExchangeRate({ exchangeRate: "48.250000" })).toBe(48.25);
    expect(frozenExchangeRate({ exchangeRate: 1 })).toBe(1);
    expect(frozenExchangeRate({ exchangeRate: null })).toBeNull();
    expect(frozenExchangeRate({})).toBeNull();
    expect(frozenExchangeRate({ exchangeRate: "0" })).toBeNull();
  });
});
