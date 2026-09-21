"use client";

import { useState } from "react";
import Link from "next/link";
import { ConfirmationDialog } from "@/components/shared/confirmation-dialog";
import { MoneyInput } from "@/components/shared/money-input";
import { EnterpriseDatePicker } from "@/components/shared/date-picker";
import { Label } from "@/components/ui/label";
import { useLocale } from "@/providers/locale-provider";
import { useUserContext } from "@/providers/user-context";
import { toast } from "@/lib/toast";
import { ApiError } from "@/services/api-client";
import { exchangeRatesService, type RequiredExchangeRate } from "@/services/fx-service";

const CREATE_RATE_PERMISSION = "exchange-rates.create";

function toIsoDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * The one "this posting needs an exchange rate" surface. Names the missing
 * pair and date, lets an authorized user record the dated rate in place
 * (the document itself is untouched), and hands control back so the caller
 * retries the same action. OMS never guesses a rate: users without the
 * permission are told where rates are managed, and nothing is posted.
 */
export function ExchangeRateRequiredDialog({
  required,
  onCancel,
  onRateSaved,
}: {
  required: RequiredExchangeRate | null;
  onCancel: () => void;
  onRateSaved: () => void;
}) {
  const { t } = useLocale();
  const { hasPermission } = useUserContext();
  const canCreate = hasPermission(CREATE_RATE_PERMISSION);
  const [rate, setRate] = useState("");
  const [effectiveDate, setEffectiveDate] = useState<Date | null>(null);
  const [saving, setSaving] = useState(false);

  const from = required?.fromCurrencyCode ?? "—";
  const to = required?.toCurrencyCode ?? "—";
  const asOfDate = required ? new Date(`${required.asOf}T00:00:00`) : null;
  const rateValue = Number(rate);
  const valid = rateValue > 0 && Number.isFinite(rateValue) && Boolean(required?.toCurrencyId);

  const reset = () => {
    setRate("");
    setEffectiveDate(null);
    setSaving(false);
  };

  const save = async () => {
    if (!required?.toCurrencyId || !valid) return;
    setSaving(true);
    try {
      await exchangeRatesService.create({
        fromCurrencyId: required.fromCurrencyId,
        toCurrencyId: required.toCurrencyId,
        rate: rateValue,
        effectiveDate: toIsoDate(effectiveDate ?? asOfDate ?? new Date()),
      });
      toast.success(t("docFlow.fx.saved", { from, to }));
      reset();
      onRateSaved();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : t("common.failedToSave"));
      setSaving(false);
    }
  };

  return (
    <ConfirmationDialog
      open={required !== null}
      onOpenChange={(open) => {
        if (!open) {
          reset();
          onCancel();
        }
      }}
      tone="warning"
      title={t("docFlow.fx.title", { from, to })}
      description={t("docFlow.fx.description", { from, to, date: required?.asOf ?? "" })}
      extra={
        canCreate ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1">
              <Label htmlFor="fx-required-rate" className="text-caption text-muted-foreground">
                {t("docFlow.fx.rateLabel", { from, to })}
              </Label>
              <MoneyInput
                id="fx-required-rate"
                autoFocus
                step="0.000001"
                min={0}
                value={rate}
                onChange={(event) => setRate(event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label className="text-caption text-muted-foreground">
                {t("docFlow.fx.effectiveDate")}
              </Label>
              <EnterpriseDatePicker value={effectiveDate ?? asOfDate} onChange={setEffectiveDate} />
            </div>
            <p className="text-caption text-muted-foreground sm:col-span-2">
              {t("docFlow.fx.noGuess")}
            </p>
          </div>
        ) : (
          <p className="text-caption text-muted-foreground">
            {t("docFlow.fx.noPermission")}{" "}
            <Link href="/finance/exchange-rates" className="text-primary hover:underline">
              {t("docFlow.fx.openRates")}
            </Link>
          </p>
        )
      }
      confirmLabel={canCreate ? t("docFlow.fx.saveAndContinue") : t("common.close")}
      confirmDisabled={canCreate && !valid}
      isConfirming={saving}
      onConfirm={() => {
        if (canCreate) void save();
        else onCancel();
      }}
    />
  );
}
