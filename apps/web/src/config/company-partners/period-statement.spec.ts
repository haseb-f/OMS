import { describe, expect, it } from "vitest";
import type { StatementPeriodRow } from "@/services/company-partners-service";
import { agreementEndFromMonths, isApproved, periodName, periodTerms } from "./period-statement";
import { buildPartnerStatementPrintPayload } from "./statement-print";

const words = { quarter: (q: number, year: number) => `Q${q} ${year}` };

const segment = (patch: Partial<StatementPeriodRow["segments"][number]> = {}) => ({
  from: "2026-03-01",
  to: "2026-03-31",
  days: 31,
  percent: 30,
  basis: "NET_PROFIT" as const,
  profitBase: { netRevenue: 100, costOfSales: 40, otherExpensesNet: 10, profit: 50 },
  baseAmount: 50,
  lossClamped: false,
  amount: 15,
  ...patch,
});

const row = (patch: Partial<StatementPeriodRow>): StatementPeriodRow => ({
  periodId: "p",
  periodFrom: "2026-03-01",
  periodTo: "2026-03-31",
  frequency: "MONTHLY",
  status: "CLOSED",
  segments: [segment()],
  entitlement: 1_500,
  adjustments: 300,
  approvedDue: 1_800,
  paid: 1_000,
  remaining: 800,
  ...patch,
});

/** R15 (spec-w4 §4-6) — presentation rules of the partner statement. */
describe("partner statement presentation", () => {
  it("names a period by its frequency in the UI language", () => {
    expect(periodName(row({}), "en", words)).toBe("March 2026");
    expect(periodName(row({}), "ar", words)).toMatch(/2026/);
    expect(periodName(row({}), "ar", words)).not.toMatch(/March/);
    expect(periodName(row({ periodFrom: "2026-07-01", frequency: "QUARTERLY" }), "en", words)).toBe(
      "Q3 2026",
    );
    expect(periodName(row({ periodFrom: "2026-01-01", frequency: "ANNUAL" }), "en", words)).toBe(
      "2026",
    );
  });

  it("lists each distinct share and basis once, in date order", () => {
    const terms = periodTerms(
      row({
        segments: [
          segment({ percent: 30 }),
          segment({ percent: 40, from: "2026-03-16" }),
          segment({ percent: 40, from: "2026-03-20" }),
        ],
      }),
      (basis) => (basis === "NET_PROFIT" ? "Net" : "Gross"),
    );
    expect(terms).toBe("30% · Net / 40% · Net");
  });

  it("only a closed period is approved", () => {
    expect(isApproved(row({ status: "CLOSED" }))).toBe(true);
    expect(isApproved(row({ status: "UNDER_REVIEW" }))).toBe(false);
    expect(isApproved(row({ status: "OPEN" }))).toBe(false);
  });

  it("turns a duration in months into the agreement's last day", () => {
    expect(agreementEndFromMonths("2026-01-01", 12)).toBe("2026-12-31");
    expect(agreementEndFromMonths("2026-03-16", 3)).toBe("2026-06-15");
    expect(agreementEndFromMonths("2026-01-31", 1)).toBe("2026-02-27");
    expect(agreementEndFromMonths("2026-11-01", 3)).toBe("2027-01-31");
    expect(agreementEndFromMonths("2026-01-01", 0)).toBeNull();
    expect(agreementEndFromMonths("2026-01-01", 1.5)).toBeNull();
  });
});

describe("partner statement print", () => {
  const labels = {
    period: "Period",
    status: "Status",
    terms: "Terms",
    entitlement: "Calculated",
    approvedDue: "Approved due",
    paid: "Paid",
    remaining: "Remaining",
    periods: "Periods",
    totalApproved: "Total approved",
    totalEstimated: "Total estimated",
    payments: "Payments",
    adjustments: "Adjustments",
    none: "—",
  };
  const payload = buildPartnerStatementPrintPayload(
    {
      periods: [
        row({}),
        row({
          periodFrom: "2026-04-01",
          periodTo: "2026-04-30",
          status: "OPEN",
          entitlement: 700,
          adjustments: null,
          approvedDue: null,
          paid: null,
          remaining: null,
        }),
      ],
      totals: { estimated: 700, approvedDue: 1_800, paid: 1_000, remaining: 800 },
      adjustments: [
        {
          periodId: "p",
          periodFrom: "2026-03-01",
          periodTo: "2026-03-31",
          date: "2026-05-02",
          reason: "Late invoice",
          amount: 300,
        },
      ],
    },
    [{ date: "2026-04-10", reference: "PPY-1", description: "Bank transfer", amount: 1_000 }],
    {
      title: "Partner statement",
      company: { name: "ACME" },
      printedByName: null,
      direction: "ltr",
      meta: [],
      notes: ["Estimates are provisional"],
      labels,
      periodName: (r) => r.periodFrom.slice(0, 7),
      statusLabel: (status) => status,
      terms: () => "30% · Net",
    },
  );

  it("is a portrait statement on the shared report template", () => {
    expect(payload).toMatchObject({
      variant: "report",
      orientation: "portrait",
      title: "Partner statement",
    });
    expect(payload.columns.map((c) => c.key)).toEqual([
      "period",
      "status",
      "terms",
      "entitlement",
      "approvedDue",
      "paid",
      "remaining",
    ]);
  });

  it("never prints an estimate under an approved column", () => {
    const april = payload.rows.find((r) => r.status === "OPEN")!;
    expect(april.entitlement).toBe("700.00");
    expect([april.approvedDue, april.paid, april.remaining]).toEqual(["", "", ""]);
    const march = payload.rows.find((r) => r.status === "CLOSED")!;
    expect([march.approvedDue, march.paid, march.remaining]).toEqual([
      "1,800.00",
      "1,000.00",
      "800.00",
    ]);
  });

  it("prints the totals, then the payment and adjustment history, under section rows", () => {
    expect(payload.rowKinds).toEqual([
      "section",
      "detail",
      "detail",
      "subtotal",
      "subtotal",
      "section",
      "detail",
      "section",
      "detail",
    ]);
    const [, , , approved, estimated, , payment, , adjustment] = payload.rows;
    expect([approved.period, approved.approvedDue, approved.remaining]).toEqual([
      "Total approved",
      "1,800.00",
      "800.00",
    ]);
    expect([estimated.period, estimated.entitlement]).toEqual(["Total estimated", "700.00"]);
    expect([payment.status, payment.terms, payment.paid]).toEqual([
      "Bank transfer",
      "PPY-1",
      "1,000.00",
    ]);
    expect([adjustment.status, adjustment.approvedDue]).toEqual(["Late invoice", "300.00"]);
  });
});
