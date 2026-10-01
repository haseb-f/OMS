import { formatMoney } from "@/lib/money";

export type CurrencyTotalsMap = Record<string, { count: number; amount: number }>;

const round2 = (value: number) => Math.round(value * 100) / 100;

/** Count + amount per currency code — unlike currencies are never added together. */
export function totalsByCurrency<T>(
  rows: readonly T[],
  pick: (row: T) => { code: string | null | undefined; amount: number | string },
): CurrencyTotalsMap {
  const totals: CurrencyTotalsMap = {};
  for (const row of rows) {
    const { code, amount } = pick(row);
    const key = code ?? "—";
    const current = totals[key] ?? { count: 0, amount: 0 };
    totals[key] = { count: current.count + 1, amount: round2(current.amount + Number(amount)) };
  }
  return totals;
}

/** "SAR 1,200.00 · EGP 300.00" — one figure per currency, never a mixed sum. */
export function formatCurrencyTotals(totals: CurrencyTotalsMap | null | undefined): string {
  const entries = Object.entries(totals ?? {}).filter(([, value]) => value.count > 0);
  return entries.length === 0
    ? "—"
    : entries.map(([code, value]) => formatMoney(value.amount, code)).join(" · ");
}
