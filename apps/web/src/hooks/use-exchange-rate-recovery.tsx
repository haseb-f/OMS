"use client";

import { useCallback, useRef, useState, type ReactNode } from "react";
import { ExchangeRateRequiredDialog } from "@/components/finance/exchange-rate-required-dialog";
import { ApiError } from "@/services/api-client";
import { exchangeRatesService, type RequiredExchangeRate } from "@/services/fx-service";

function missingRateFromError(error: unknown): RequiredExchangeRate | null {
  if (!(error instanceof ApiError) || error.code !== "MISSING_EXCHANGE_RATE") return null;
  const details = error.details ?? {};
  if (typeof details.fromCurrencyId !== "string" || typeof details.asOf !== "string") return null;
  const text = (value: unknown) => (typeof value === "string" ? value : null);
  return {
    fromCurrencyId: details.fromCurrencyId,
    toCurrencyId: text(details.toCurrencyId),
    fromCurrencyCode: text(details.fromCurrencyCode),
    toCurrencyCode: text(details.toCurrencyCode),
    asOf: details.asOf,
  };
}

export type ExchangeRateGuardedRun = <T>(
  action: () => Promise<T>,
  options?: { currencyId?: string | null },
) => Promise<T | null>;

/**
 * Wraps any posting action (post invoice, confirm receipt, verify payment…)
 * so a missing exchange rate is a recoverable step instead of a failed
 * transition: checked up front when the document currency is known, and
 * caught from the API as a fallback. The user supplies the dated rate, the
 * SAME action is retried, and unsaved form state is never lost. Resolves to
 * the action's result, or `null` when the user backs out.
 */
export function useExchangeRateRecovery(): { run: ExchangeRateGuardedRun; dialog: ReactNode } {
  const [required, setRequired] = useState<RequiredExchangeRate | null>(null);
  const pendingRef = useRef<((retry: boolean) => void) | null>(null);

  const askForRate = useCallback(
    (missing: RequiredExchangeRate) =>
      new Promise<boolean>((resolve) => {
        pendingRef.current = resolve;
        setRequired(missing);
      }),
    [],
  );

  const settle = useCallback((retry: boolean) => {
    const resolve = pendingRef.current;
    pendingRef.current = null;
    setRequired(null);
    resolve?.(retry);
  }, []);

  const run = useCallback<ExchangeRateGuardedRun>(
    async (action, options) => {
      if (options?.currencyId) {
        const check = await exchangeRatesService.check(options.currencyId).catch(() => null);
        if (check?.required && !check.available && !(await askForRate(check))) return null;
      }
      for (;;) {
        try {
          return await action();
        } catch (error) {
          const missing = missingRateFromError(error);
          if (!missing) throw error;
          if (!(await askForRate(missing))) return null;
        }
      }
    },
    [askForRate],
  );

  return {
    run,
    dialog: (
      <ExchangeRateRequiredDialog
        required={required}
        onCancel={() => settle(false)}
        onRateSaved={() => settle(true)}
      />
    ),
  };
}
