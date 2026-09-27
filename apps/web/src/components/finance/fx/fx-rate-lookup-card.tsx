"use client";

import { useState } from "react";
import { Search } from "lucide-react";
import { EnterpriseButton } from "@/components/ui/button";
import {
  EnterpriseCard,
  EnterpriseCardContent,
  EnterpriseCardDescription,
  EnterpriseCardHeader,
  EnterpriseCardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { CurrencyPicker } from "@/components/business/currency-picker";
import { EnterpriseDatePicker } from "@/components/shared/date-picker";
import { toISODate } from "@/lib/date";
import { reportApiError } from "@/lib/toast";
import { useLocale } from "@/providers/locale-provider";
import { exchangeRatesService, type ExchangeRateCheck } from "@/services/fx-service";
import { formatFxRate, fxDayLabel, fxSourceLabel, fxWeekday } from "./fx-format";
import { formatDate } from "@/lib/date";

/**
 * "Which rate would a document dated D use?" — runs the exact server-side
 * resolution posting uses (override → official/manual within the staleness
 * window → fail closed) and explains weekend/holiday fallback or the error.
 */
export function FxRateLookupCard() {
  const { t } = useLocale();
  const [currencyId, setCurrencyId] = useState("");
  const [date, setDate] = useState<Date | null>(new Date());
  const [result, setResult] = useState<ExchangeRateCheck | null>(null);
  const [busy, setBusy] = useState(false);

  const lookup = async () => {
    if (!currencyId || !date) return;
    setBusy(true);
    try {
      setResult(await exchangeRatesService.resolve(currencyId, toISODate(date)));
    } catch (error) {
      setResult(null);
      reportApiError(error, t("errors.generic"));
    } finally {
      setBusy(false);
    }
  };

  const ageDays =
    result?.effectiveDate && result.asOf
      ? Math.round(
          (Date.parse(`${result.asOf}T00:00:00Z`) -
            Date.parse(`${result.effectiveDate}T00:00:00Z`)) /
            86_400_000,
        )
      : 0;

  return (
    <EnterpriseCard className="gap-0 py-3" data-testid="fx-rate-lookup">
      <EnterpriseCardHeader className="px-4 pb-2">
        <EnterpriseCardTitle className="text-body">
          {t("fxSettings.lookup.title")}
        </EnterpriseCardTitle>
        <EnterpriseCardDescription>{t("fxSettings.lookup.description")}</EnterpriseCardDescription>
      </EnterpriseCardHeader>
      <EnterpriseCardContent className="flex flex-col gap-3 px-4">
        <div className="grid grid-cols-1 items-end gap-3 sm:grid-cols-[1fr_1fr_auto]">
          <div className="flex min-w-0 flex-col gap-1.5">
            <Label htmlFor="fx-lookup-currency">{t("fxSettings.lookup.currency")}</Label>
            <CurrencyPicker
              id="fx-lookup-currency"
              valueKey="id"
              value={currencyId}
              onValueChange={(value) => {
                setCurrencyId(value);
                setResult(null);
              }}
            />
          </div>
          <div className="flex min-w-0 flex-col gap-1.5">
            <Label htmlFor="fx-lookup-date">{t("fxSettings.lookup.date")}</Label>
            <EnterpriseDatePicker
              id="fx-lookup-date"
              value={date}
              onChange={(value) => {
                setDate(value);
                setResult(null);
              }}
            />
          </div>
          <EnterpriseButton
            type="button"
            onClick={() => void lookup()}
            disabled={!currencyId || !date}
            isLoading={busy}
          >
            <Search />
            {t("fxSettings.lookup.check")}
          </EnterpriseButton>
        </div>

        {result ? (
          result.available ? (
            <div
              className="rounded-md border border-border bg-muted/40 p-3"
              data-testid="fx-lookup-result"
            >
              {result.required ? (
                <>
                  <p className="text-body font-semibold tabular-nums" dir="ltr">
                    {t("fxSettings.lookup.result", {
                      from: result.fromCurrencyCode ?? "",
                      rate: formatFxRate(result.rate),
                      to: result.toCurrencyCode ?? "",
                    })}
                  </p>
                  <p className="text-caption text-muted-foreground">
                    {t("fxSettings.lookup.sourceLine", { source: fxSourceLabel(t, result.source) })}
                  </p>
                  <p className="text-caption">
                    {result.source === "OVERRIDE"
                      ? t("fxSettings.lookup.overrideLine", { asOf: fxDayLabel(t, result.asOf) })
                      : ageDays > 0
                        ? t("fxSettings.lookup.fallback", {
                            asOfDay: fxWeekday(t, result.asOf),
                            asOf: formatDate(result.asOf),
                            effectiveDay: fxWeekday(t, result.effectiveDate),
                            effectiveDate: formatDate(result.effectiveDate),
                            days: ageDays,
                          })
                        : t("fxSettings.lookup.sameDay", {
                            effectiveDay: fxWeekday(t, result.effectiveDate),
                            effectiveDate: formatDate(result.effectiveDate),
                          })}
                  </p>
                </>
              ) : (
                <p className="text-body">
                  {t("fxSettings.lookup.base", { code: result.fromCurrencyCode ?? "" })}
                </p>
              )}
            </div>
          ) : (
            <Alert tone={result.errorCode === "STALE_EXCHANGE_RATE" ? "warning" : "destructive"}>
              <AlertTitle>
                {result.errorCode === "STALE_EXCHANGE_RATE"
                  ? t("fxSettings.lookup.staleTitle")
                  : t("fxSettings.lookup.missingTitle")}
              </AlertTitle>
              <AlertDescription>{result.message}</AlertDescription>
            </Alert>
          )
        ) : null}
      </EnterpriseCardContent>
    </EnterpriseCard>
  );
}
