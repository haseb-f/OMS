/**
 * Count + amount per currency code. Unlike currencies are never added
 * together — every payment/reconciliation summary keeps one bucket per code.
 */
export type CurrencyTotals = Record<string, { count: number; amount: number }>;

const round2 = (value: number) => Math.round(value * 100) / 100;

export function addCurrencyTotal(
  bucket: CurrencyTotals,
  code: string,
  count: number,
  amount: number,
): void {
  const current = bucket[code] ?? { count: 0, amount: 0 };
  bucket[code] = {
    count: current.count + count,
    amount: round2(current.amount + amount),
  };
}
