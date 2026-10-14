"use client";

import { MoneyValue } from "@/components/shared/money-value";
import { useFunctionalCurrencyCode } from "@/hooks/use-functional-currency";

/**
 * R22 §5 — a money cell that always names its currency. A record in the base
 * (functional) currency carries no currency of its own (`currencyId` null), so
 * the Settings → Accounting code is shown instead — never a bare figure.
 */
export function BaseAwareMoneyValue({
  value,
  currency,
  className,
}: {
  value: string | number;
  currency?: string | null;
  className?: string;
}) {
  const functional = useFunctionalCurrencyCode(!currency);
  return (
    <MoneyValue
      value={value}
      currency={currency || functional || undefined}
      className={className}
    />
  );
}
