import { describe, expect, it, vi } from "vitest";

vi.mock("@/providers/locale-provider", () => ({
  useLocale: () => ({ t: (key: string) => key, locale: "ar", direction: "rtl" }),
}));

import { agingCurrencyTotals } from "./aging-tab";
import type { AgingResult } from "@/services/accounting-reports-service";

const row = (total: number) => ({
  partnerId: "p",
  partnerNumber: "C-1",
  partnerName: "عميل",
  current: total,
  days31to60: 0,
  days61to90: 0,
  over90: 0,
  total,
  unapplied: 0,
  net: total,
});

describe("aging per currency (R22 A1)", () => {
  it("uses the API's per-currency totals — never one sum across currencies", () => {
    const result = {
      side: "AR",
      asOfDate: "2026-10-14",
      partners: [],
      invoices: [],
      totals: row(86500),
      totalsByCurrency: [
        { ...row(86500), currencyId: "egp", currencyCode: "EGP" },
        { ...row(1150), currencyId: "sar", currencyCode: "SAR" },
      ],
    } as unknown as AgingResult;
    expect(agingCurrencyTotals(result).map((totals) => [totals.currencyCode, totals.net])).toEqual([
      ["EGP", 86500],
      ["SAR", 1150],
    ]);
  });

  it("falls back to the single functional-currency totals of an older API", () => {
    const result = {
      side: "AR",
      asOfDate: "2026-10-14",
      partners: [],
      invoices: [],
      totals: row(500),
      totalsCurrencyCode: "EGP",
    } as unknown as AgingResult;
    expect(agingCurrencyTotals(result)).toMatchObject([{ currencyCode: "EGP", total: 500 }]);
  });
});
