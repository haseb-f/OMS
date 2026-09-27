import { formatAmount } from "@/lib/money";

/**
 * Investor-module figure cells: the shared `formatAmount` (Latin digits,
 * quiet "—" for zero) in an isolated `num` run. The cell/column owns the
 * logical end alignment (`CompactDetailTable align="end"`,
 * `<TableCell numeric>`), so these render inline only.
 */
export function Amount({
  value,
  currency,
}: {
  value: number | string | null | undefined;
  currency?: string | null;
}) {
  return <span className="num">{formatAmount(value, { zero: "dash", currency })}</span>;
}

/** A percentage with two decimals (participation, sell-through). */
export function Percent({ value, decimals = 2 }: { value: number; decimals?: number }) {
  return <span className="num">{`${formatAmount(value, { decimals, zero: "zero" })}%`}</span>;
}
