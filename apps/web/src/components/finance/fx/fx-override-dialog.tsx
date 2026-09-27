"use client";

import { useState } from "react";
import { EnterpriseButton } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { EnterpriseModal } from "@/components/shared/enterprise-modal";
import {
  EnterpriseDateRangePicker,
  type DateRangeValue,
} from "@/components/shared/date-range-picker";
import { CurrencyPicker } from "@/components/business/currency-picker";
import { formatDateRange, toISODate } from "@/lib/date";
import { toast, reportApiError } from "@/lib/toast";
import { ApiError } from "@/services/api-client";
import { useCurrencies } from "@/hooks/use-reference-data";
import { useLocale } from "@/providers/locale-provider";
import { fxOverridesService } from "@/services/fx-service";

const EMPTY_RANGE: DateRangeValue = { from: null, to: null };

/**
 * Add a dated manual override (1 FOREIGN = rate base for every day of an
 * inclusive range). The server — and ultimately the database exclusion
 * constraint — rejects overlapping ranges; that 409 is shown inline with the
 * conflicting range so the user knows exactly what to change.
 */
export function FxOverrideDialog({
  open,
  onOpenChange,
  baseCurrencyId,
  baseCode,
  defaultCurrencyId,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  baseCurrencyId: string | null;
  baseCode: string;
  defaultCurrencyId?: string;
  onSaved: () => Promise<void> | void;
}) {
  const { t } = useLocale();
  const currencies = useCurrencies();
  const [currencyId, setCurrencyId] = useState(defaultCurrencyId ?? "");
  const [range, setRange] = useState<DateRangeValue>(EMPTY_RANGE);
  const [rate, setRate] = useState("");
  const [reason, setReason] = useState("");
  const [conflict, setConflict] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [lastOpen, setLastOpen] = useState(open);

  // Fresh form each time the dialog opens (state reset during render, not in an effect).
  if (open !== lastOpen) {
    setLastOpen(open);
    if (open) {
      setCurrencyId(defaultCurrencyId ?? "");
      setRange(EMPTY_RANGE);
      setRate("");
      setReason("");
      setConflict(null);
    }
  }

  const code = currencies.find((c) => c.id === currencyId)?.code ?? "";
  const rateNumber = Number(rate);
  const isBase = Boolean(currencyId) && currencyId === baseCurrencyId;
  const valid =
    Boolean(currencyId) &&
    !isBase &&
    Boolean(range.from && range.to) &&
    rateNumber > 0 &&
    Number.isFinite(rateNumber) &&
    reason.trim().length >= 3;
  const dirty = Boolean(currencyId || range.from || rate || reason);

  const save = async () => {
    if (!valid || !range.from || !range.to) return;
    setSaving(true);
    setConflict(null);
    try {
      await fxOverridesService.create({
        fromCurrencyId: currencyId,
        rate: rateNumber,
        dateFrom: toISODate(range.from),
        dateTo: toISODate(range.to),
        reason: reason.trim(),
      });
      toast.success(
        t("fxSettings.overrides.created", {
          pair: `${code}/${baseCode}`,
          range: formatDateRange(range.from, range.to),
        }),
      );
      onOpenChange(false);
      await onSaved();
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        const existing = error.details?.conflictingRange as
          { dateFrom?: string; dateTo?: string } | undefined;
        setConflict(
          existing?.dateFrom && existing.dateTo
            ? t("fxSettings.overrides.overlapBody", {
                range: formatDateRange(existing.dateFrom, existing.dateTo),
                rate: String(error.details?.conflictingRate ?? "—"),
              })
            : error.message,
        );
      } else {
        reportApiError(error, t("errors.generic"));
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <EnterpriseModal
      open={open}
      onOpenChange={onOpenChange}
      title={t("fxSettings.overrides.dialogTitle")}
      description={t("fxSettings.addRate.canonicalNote", { base: baseCode })}
      isDirty={dirty}
      footer={(requestClose) => (
        <>
          <EnterpriseButton type="button" variant="outline" onClick={requestClose}>
            {t("common.cancel")}
          </EnterpriseButton>
          <EnterpriseButton
            type="button"
            onClick={() => void save()}
            disabled={!valid}
            isLoading={saving}
          >
            {t("common.save")}
          </EnterpriseButton>
        </>
      )}
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-1.5">
          <Label htmlFor="fx-override-currency">{t("fxSettings.overrides.currency")}</Label>
          <CurrencyPicker
            id="fx-override-currency"
            valueKey="id"
            value={currencyId}
            error={isBase}
            onValueChange={(value) => {
              setCurrencyId(value);
              setConflict(null);
            }}
          />
          {isBase ? (
            <p className="text-caption text-destructive">
              {t("fxSettings.addRate.canonicalNote", { base: baseCode })}
            </p>
          ) : null}
        </div>
        <div className="flex min-w-0 flex-col gap-1.5">
          <Label>{t("fxSettings.overrides.range")}</Label>
          <EnterpriseDateRangePicker
            value={range}
            onChange={(value) => {
              setRange(value);
              setConflict(null);
            }}
          />
        </div>
        <div className="flex min-w-0 flex-col gap-1.5">
          <Label htmlFor="fx-override-rate">{t("fxSettings.overrides.rate")}</Label>
          <Input
            id="fx-override-rate"
            type="number"
            inputMode="decimal"
            min={0}
            step="any"
            dir="ltr"
            value={rate}
            onChange={(event) => setRate(event.target.value)}
          />
          <p className="text-caption text-muted-foreground" dir="ltr">
            {t("fxSettings.overrides.rateHint", { from: code || "—", base: baseCode })}
          </p>
        </div>
        <div className="flex min-w-0 flex-col gap-1.5 sm:col-span-2">
          <Label htmlFor="fx-override-reason">{t("fxSettings.overrides.reason")}</Label>
          <Textarea
            id="fx-override-reason"
            rows={2}
            value={reason}
            placeholder={t("fxSettings.overrides.reasonPlaceholder")}
            onChange={(event) => setReason(event.target.value)}
          />
        </div>
      </div>
      {conflict ? (
        <Alert tone="destructive" className="mt-3" data-testid="fx-override-conflict">
          <AlertTitle>{t("fxSettings.overrides.overlapTitle")}</AlertTitle>
          <AlertDescription>{conflict}</AlertDescription>
        </Alert>
      ) : null}
    </EnterpriseModal>
  );
}
