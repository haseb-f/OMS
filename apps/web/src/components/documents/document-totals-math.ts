/**
 * Pure totals math shared by every document editor's totals block. Each
 * function reproduces, exactly, the computation its editor did inline before
 * the totals presentation was unified — only the presentation moved.
 */

/** Tolerance below which a debit/credit difference counts as balanced (unchanged from the journal grid). */
export const JOURNAL_BALANCE_TOLERANCE = 0.001;

export interface JournalBalance {
  totalDebit: number;
  totalCredit: number;
  /** Debit minus credit — positive: debit side is larger. */
  difference: number;
  isBalanced: boolean;
}

export function journalBalance(
  lines: readonly { debit: number; credit: number }[],
): JournalBalance {
  const totalDebit = lines.reduce((sum, line) => sum + line.debit, 0);
  const totalCredit = lines.reduce((sum, line) => sum + line.credit, 0);
  const difference = totalDebit - totalCredit;
  return {
    totalDebit,
    totalCredit,
    difference,
    isBalanced: Math.abs(difference) < JOURNAL_BALANCE_TOLERANCE,
  };
}

export interface PaymentAllocationTotals {
  amount: number;
  allocatedTotal: number;
  /** What is still unallocated — never negative. */
  unallocated: number;
  isOverAllocated: boolean;
}

export function paymentAllocationTotals(
  amount: number,
  allocations: readonly { allocatedAmount: number }[],
): PaymentAllocationTotals {
  const allocatedTotal = allocations.reduce((sum, line) => sum + line.allocatedAmount, 0);
  return {
    amount,
    allocatedTotal,
    unallocated: Math.max(amount - allocatedTotal, 0),
    isOverAllocated: allocatedTotal > amount,
  };
}

export interface CommercialTotalsInput {
  subtotal: number;
  discountTotal: number;
  taxTotal: number;
  shippingTotal?: number;
  grandTotal: number;
}

export type CommercialTotalsRowKey = "subtotal" | "discount" | "tax" | "shipping";

/**
 * The detail rows of a commercial document's totals block, in display order.
 * Discount shows as a negative amount; shipping only when non-zero.
 */
export function commercialTotalsRows(
  totals: CommercialTotalsInput,
): { key: CommercialTotalsRowKey; value: number }[] {
  return [
    { key: "subtotal", value: totals.subtotal },
    { key: "discount", value: totals.discountTotal ? -totals.discountTotal : 0 },
    { key: "tax", value: totals.taxTotal },
    ...(totals.shippingTotal ? [{ key: "shipping" as const, value: totals.shippingTotal }] : []),
  ];
}
