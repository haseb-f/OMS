import { cn } from "@/lib/utils";
import { CurrencyDisplay } from "./currency-display";

/** A pill-shaped amount, tinted green for incoming/positive and red for outgoing/negative. */
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
  const toneClasses = {
    positive: "bg-success/10 text-success",
    negative: "bg-destructive/10 text-destructive",
    neutral: "bg-muted text-foreground",
  } as const;

  return (
    <span
      className={cn(
        "inline-flex h-6 items-center rounded-full px-2.5 text-caption font-semibold",
        toneClasses[tone],
        className,
      )}
    >
      <CurrencyDisplay amount={amount} currency={currency} />
    </span>
  );
}
