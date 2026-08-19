import { EnterpriseBadge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { CurrencyDisplay } from "./currency-display";

const TONE_VARIANT = {
  positive: "success",
  negative: "destructive",
  neutral: "secondary",
} as const;

/**
 * A tinted amount — green for incoming/positive, red for outgoing/negative.
 * Renders through `EnterpriseBadge` so tone colors, height, radius, and type
 * scale come from the one badge system rather than a parallel set of pill
 * classes that drifts every time the badge tokens change.
 */
export function MoneyBadge({
  amount,
  currency,
  tone = amount < 0 ? "negative" : "positive",
  className,
}: {
  amount: number;
  currency: string;
  tone?: "positive" | "negative" | "neutral";
  className?: string;
}) {
  return (
    <EnterpriseBadge variant={TONE_VARIANT[tone]} className={cn("font-semibold", className)}>
      <CurrencyDisplay amount={amount} currency={currency} />
    </EnterpriseBadge>
  );
}
