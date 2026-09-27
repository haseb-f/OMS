// @vitest-environment node
import { describe, expect, it } from "vitest";
import { EMPTY_REPORT_FILTERS } from "@/components/accounting/report-filter-bar";
import {
  accountStatementHref,
  filtersFromSearchParams,
  partnerStatementHref,
  writeFiltersToSearchParams,
} from "./report-url";

const FILTERS = {
  ...EMPTY_REPORT_FILTERS,
  companyId: "c1",
  costCenterId: "cc1",
  dateRange: { from: new Date(2026, 0, 1), to: new Date(2026, 8, 30) },
  postedOnly: false,
};

describe("report filters in the URL", () => {
  it("round-trips every filter and omits defaults", () => {
    const params = writeFiltersToSearchParams(FILTERS, new URLSearchParams("report=trialBalance"));
    expect(params.get("report")).toBe("trialBalance");
    expect(params.get("from")).toBe("2026-01-01");
    expect(params.get("to")).toBe("2026-09-30");
    expect(params.get("posted")).toBe("0");
    expect(params.has("branch")).toBe(false);
    const back = filtersFromSearchParams(params);
    expect(back.companyId).toBe("c1");
    expect(back.costCenterId).toBe("cc1");
    expect(back.postedOnly).toBe(false);
    expect(back.dateRange.from?.getDate()).toBe(1);
    expect(back.dateRange.to?.getMonth()).toBe(8);
  });

  it("defaults to posted-only with no dates", () => {
    const empty = filtersFromSearchParams(new URLSearchParams());
    expect(empty).toEqual(EMPTY_REPORT_FILTERS);
    expect(writeFiltersToSearchParams(EMPTY_REPORT_FILTERS).toString()).toBe("");
  });

  it("builds same-scope drill-down links", () => {
    const account = new URL(accountStatementHref("acc-1", FILTERS), "http://x");
    expect(account.pathname).toBe("/reports/finance");
    expect(account.searchParams.get("report")).toBe("accountStatement");
    expect(account.searchParams.get("account")).toBe("acc-1");
    expect(account.searchParams.get("from")).toBe("2026-01-01");
    const supplier = new URL(partnerStatementHref("p-1", "SUPPLIER", FILTERS), "http://x");
    expect(supplier.searchParams.get("report")).toBe("supplierStatement");
    expect(supplier.searchParams.get("partner")).toBe("p-1");
    expect(supplier.searchParams.get("company")).toBe("c1");
  });
});
