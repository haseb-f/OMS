import { describe, expect, it } from "vitest";
import {
  commercialTotalsRows,
  journalBalance,
  paymentAllocationTotals,
} from "./document-totals-math";

/** The inline computations the editors used before the totals block was shared. */
function legacyJournal(lines: { debit: number; credit: number }[]) {
  const totalDebit = lines.reduce((sum, l) => sum + l.debit, 0);
  const totalCredit = lines.reduce((sum, l) => sum + l.credit, 0);
  const difference = totalDebit - totalCredit;
  return { totalDebit, totalCredit, difference, isBalanced: Math.abs(difference) < 0.001 };
}

describe("journalBalance", () => {
  const cases: { debit: number; credit: number }[][] = [
    [],
    [
      { debit: 100, credit: 0 },
      { debit: 0, credit: 100 },
    ],
    [
      { debit: 1234567890.12, credit: 0 },
      { debit: 0, credit: 1234567890.11 },
    ],
    [
      { debit: 0.1, credit: 0 },
      { debit: 0.2, credit: 0 },
      { debit: 0, credit: 0.3 },
    ],
    [
      { debit: 0, credit: 50.5 },
      { debit: 20, credit: 0 },
    ],
  ];

  it.each(cases.map((lines, index) => [index, lines] as const))(
    "matches the previous inline computation (case %i)",
    (_index, lines) => {
      expect(journalBalance(lines)).toEqual(legacyJournal(lines));
    },
  );

  it("flags a non-zero difference as unbalanced and keeps its sign", () => {
    const result = journalBalance([
      { debit: 0, credit: 50.5 },
      { debit: 20, credit: 0 },
    ]);
    expect(result.isBalanced).toBe(false);
    expect(result.difference).toBeCloseTo(-30.5);
  });

  it("treats floating-point dust as balanced", () => {
    expect(
      journalBalance([
        { debit: 0.1, credit: 0 },
        { debit: 0.2, credit: 0 },
        { debit: 0, credit: 0.3 },
      ]).isBalanced,
    ).toBe(true);
  });
});

describe("paymentAllocationTotals", () => {
  it("matches the previous payment summary math", () => {
    const allocations = [{ allocatedAmount: 40 }, { allocatedAmount: 25.5 }];
    const allocatedTotal = allocations.reduce((sum, line) => sum + line.allocatedAmount, 0);
    expect(paymentAllocationTotals(100, allocations)).toEqual({
      amount: 100,
      allocatedTotal,
      unallocated: Math.max(100 - allocatedTotal, 0),
      isOverAllocated: allocatedTotal > 100,
    });
  });

  it("never reports a negative unallocated amount", () => {
    const result = paymentAllocationTotals(50, [{ allocatedAmount: 80 }]);
    expect(result.unallocated).toBe(0);
    expect(result.isOverAllocated).toBe(true);
  });
});

describe("commercialTotalsRows", () => {
  it("shows discount as a negative amount and omits zero shipping", () => {
    expect(
      commercialTotalsRows({ subtotal: 200, discountTotal: 20, taxTotal: 27, grandTotal: 207 }),
    ).toEqual([
      { key: "subtotal", value: 200 },
      { key: "discount", value: -20 },
      { key: "tax", value: 27 },
    ]);
  });

  it("keeps a zero discount as +0 and includes shipping when present", () => {
    const rows = commercialTotalsRows({
      subtotal: 10,
      discountTotal: 0,
      taxTotal: 0,
      shippingTotal: 5,
      grandTotal: 15,
    });
    expect(Object.is(rows[1].value, 0)).toBe(true);
    expect(rows.map((row) => row.key)).toEqual(["subtotal", "discount", "tax", "shipping"]);
  });
});
