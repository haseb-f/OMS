"use client";

import { useEffect, useMemo, useState } from "react";
import { useLocale } from "@/providers/locale-provider";
import { accountingSettingsService } from "@/services/accounting-settings-service";

/** Localized Dr/Cr side labels for `drcr` balances (مدين/دائن · Dr/Cr). */
export function useDrCrLabels(): { debit: string; credit: string } {
  const { t } = useLocale();
  return useMemo(
    () => ({ debit: t("reports.finance.side.debit"), credit: t("reports.finance.side.credit") }),
    [t],
  );
}

let functionalCurrencyRequest: Promise<string> | null = null;

function loadFunctionalCurrency(): Promise<string> {
  functionalCurrencyRequest ??= accountingSettingsService
    .get()
    .then((settings) => settings.functionalCurrency?.code ?? "")
    .catch(() => {
      // Retry on the next report mount instead of caching the failure.
      functionalCurrencyRequest = null;
      return "";
    });
  return functionalCurrencyRequest;
}

/**
 * The functional (reporting) currency code every Journal-Entry-based report
 * is stated in — the API reports functional amounts regardless of the
 * Currency filter (which only narrows the entries). Fetched once per session.
 */
export function useReportCurrency(): string {
  const [code, setCode] = useState("");
  useEffect(() => {
    let cancelled = false;
    void loadFunctionalCurrency().then((value) => {
      if (!cancelled) setCode(value);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return code;
}
