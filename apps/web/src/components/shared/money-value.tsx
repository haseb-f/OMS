import { SemanticValue } from "@/components/shared/semantic-value";
import { currencyCodeOf, formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";

/** LTR tabular money — the one financial display for table cells and summaries. */
export function MoneyValue({
  value,
  currency,
  className,
}: {
  value: string | number;
  currency?: string | { code: string } | null;
  className?: string;
}) {
  return (
    <SemanticValue kind="money" className={cn("font-medium", className)}>
      {formatMoney(value, currencyCodeOf(currency))}
    </SemanticValue>
  );
}
