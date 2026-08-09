import { cn } from "@/lib/utils";

/**
 * The one place amounts are formatted — every business module renders money
 * through this instead of hand-rolling `toFixed()` + a currency symbol.
 * Uses `Intl.NumberFormat` so grouping/decimals follow the active locale.
 */
export function CurrencyDisplay({
  amount,
  currency,
  locale = "en-US",
  className,
}: {
  amount: number;
  currency: string;
  locale?: string;
  className?: string;
}) {
  const formatted = new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    currencyDisplay: "narrowSymbol",
  }).format(amount);

  return <span className={cn("tabular-nums", className)}>{formatted}</span>;
}
