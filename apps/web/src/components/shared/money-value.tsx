import { SemanticValue } from "@/components/shared/semantic-value";
import { currencyCodeOf, formatAmountParts, formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";

/**
 * LTR tabular money — the one financial display for table cells and summaries.
 * `currencyClassName` (R19 §C2, report cards) sets the currency code apart from the figure
 * (e.g. smaller and quieter); the text stays exactly `formatMoney(value, code)`.
 * `currencyHue` (R20 §B2, report cards) names the code's colour (`data-currency`, the currency
 * mapping in components/reports/report-identity.ts); the code itself is always shown.
 */
export function MoneyValue({
  value,
  currency,
  className,
  currencyClassName,
  currencyHue,
}: {
  value: string | number;
  currency?: string | { code: string } | null;
  className?: string;
  currencyClassName?: string;
  currencyHue?: string;
}) {
  const code = currencyCodeOf(currency);
  if (currencyClassName) {
    const parts = formatAmountParts(value, { currency: code, negative: "minus", zero: "zero" });
    if (parts.figure && parts.currency) {
      // R20 §B — figure and code are two runs of one LTR line, so in a narrow card the code
      // wraps under the figure instead of overflowing; the figure itself never breaks.
      return (
        <span
          dir="ltr"
          data-slot="money-split"
          className="inline-flex max-w-full min-w-0 flex-wrap items-baseline gap-x-1 [unicode-bidi:isolate]"
        >
          <SemanticValue kind="money" className={cn("font-medium", className)}>
            {parts.figure}
          </SemanticValue>{" "}
          <span
            data-slot="money-currency"
            data-currency={currencyHue}
            className={currencyClassName}
          >
            {parts.currency}
          </span>
        </span>
      );
    }
  }
  return (
    <SemanticValue kind="money" className={cn("font-medium", className)}>
      {formatMoney(value, code)}
    </SemanticValue>
  );
}
