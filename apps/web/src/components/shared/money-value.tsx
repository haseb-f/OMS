import { SemanticValue } from "@/components/shared/semantic-value";
import { currencyCodeOf, formatAmountParts, formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";

/**
 * LTR tabular money — the one financial display for table cells and summaries.
 * `currencyClassName` (R19 §C2, report cards) sets the currency code apart from the figure
 * (e.g. smaller and quieter); the text stays exactly `formatMoney(value, code)`.
 */
export function MoneyValue({
  value,
  currency,
  className,
  currencyClassName,
}: {
  value: string | number;
  currency?: string | { code: string } | null;
  className?: string;
  currencyClassName?: string;
}) {
  const code = currencyCodeOf(currency);
  if (currencyClassName) {
    const parts = formatAmountParts(value, { currency: code, negative: "minus", zero: "zero" });
    if (parts.figure && parts.currency) {
      return (
        <SemanticValue kind="money" className={cn("font-medium", className)}>
          {parts.figure}{" "}
          <span data-slot="money-currency" className={currencyClassName}>
            {parts.currency}
          </span>
        </SemanticValue>
      );
    }
  }
  return (
    <SemanticValue kind="money" className={cn("font-medium", className)}>
      {formatMoney(value, code)}
    </SemanticValue>
  );
}
