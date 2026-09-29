import { describe, expect, it } from "vitest";
import { autoPrintColumnWidths } from "./print-column-widths";

const pct = (w: string | undefined) => Number(w?.replace("%", ""));

describe("autoPrintColumnWidths", () => {
  const columns = [
    { key: "date", label: "التاريخ" },
    { key: "account", label: "الحساب" },
    { key: "partner", label: "الطرف" },
    { key: "debit", label: "مدين", align: "end" as const },
  ];
  const rows = Array.from({ length: 20 }, (_, i) => ({
    date: "2026-09-28",
    account: "1121 — حساب التسوية لبوابة الدفع تمارا (QA)",
    partner: i === 0 ? "عميل" : "",
    debit: "1,000.00",
  }));

  it("gives the long Account column more width than the mostly-empty Partner column", () => {
    const sized = autoPrintColumnWidths(columns, rows);
    expect(pct(sized[1].width)).toBeGreaterThan(pct(sized[2].width) * 3);
  });

  it("sums to 100% and respects the min/max share", () => {
    const sized = autoPrintColumnWidths(columns, rows);
    const total = sized.reduce((sum, c) => sum + pct(c.width), 0);
    expect(total).toBeCloseTo(100, 1);
    for (const c of sized) expect(pct(c.width)).toBeGreaterThanOrEqual(4.9);
  });

  it("keeps explicit widths untouched", () => {
    const explicit = [
      { key: "a", label: "A", width: "30mm" },
      { key: "b", label: "B" },
    ];
    expect(autoPrintColumnWidths(explicit, [{ a: "x", b: "y" }])).toBe(explicit);
  });

  it("does nothing for empty tables or a single column", () => {
    expect(autoPrintColumnWidths(columns, [])).toBe(columns);
    const one = [{ key: "a", label: "A" }];
    expect(autoPrintColumnWidths(one, [{ a: "x" }])).toBe(one);
  });
});
