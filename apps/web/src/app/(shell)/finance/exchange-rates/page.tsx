"use client";

import { useCallback, useEffect, useState } from "react";
import { z } from "zod";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { PageWorkspace } from "@/components/shared/page-workspace";
import { EnterpriseButton } from "@/components/ui/button";
import {
  EnterpriseCard,
  EnterpriseCardContent,
  EnterpriseCardHeader,
  EnterpriseCardTitle,
} from "@/components/ui/card";
import { MasterDataForm } from "@/components/master-data/master-data-form";
import { EnterpriseModal } from "@/components/shared/enterprise-modal";
import { ConfirmationDialog } from "@/components/shared/confirmation-dialog";
import { PermissionGate } from "@/components/shared/permission-gate";
import { StatusBadge } from "@/components/business/status-badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { EnterpriseDatePicker } from "@/components/shared/date-picker";
import { toISODate, formatDate } from "@/lib/date";
import {
  exchangeRatesService,
  fxRevaluationsService,
  type ExchangeRateRow,
  type FxRevaluationRunRow,
} from "@/services/fx-service";
import { accountingSettingsService } from "@/services/accounting-settings-service";
import { useCurrencies } from "@/hooks/use-reference-data";
import { useLocale } from "@/providers/locale-provider";
import { useUserContext } from "@/providers/user-context";
import { toast } from "@/lib/toast";
import { ApiError } from "@/services/api-client";
import type { MessageKey } from "@/i18n/translate";

const rateSchema = z.object({
  fromCurrencyId: z.string().min(1),
  toCurrencyId: z.string().min(1),
  rate: z.number().min(0.00000001),
  effectiveDate: z.string().min(1),
  notes: z.string().optional().or(z.literal("")),
});

function FxPageContent() {
  const { t } = useLocale();
  const { hasPermission } = useUserContext();
  const canCreateRate = hasPermission("exchange-rates.create");
  const canRevalue = hasPermission("fx-revaluations.post");

  const [rates, setRates] = useState<ExchangeRateRow[]>([]);
  const [runs, setRuns] = useState<FxRevaluationRunRow[]>([]);
  // Session-cached reference list (no per-mount /currencies fetch).
  const currencies = useCurrencies();
  const [rateOpen, setRateOpen] = useState(false);
  const [revalueOpen, setRevalueOpen] = useState(false);
  const [rateDate, setRateDate] = useState<Date | undefined>(new Date());
  const [busy, setBusy] = useState(false);
  const [baseCurrencyId, setBaseCurrencyId] = useState<string | null | undefined>(undefined);

  const form = useForm({
    resolver: zodResolver(rateSchema),
    defaultValues: {
      fromCurrencyId: "",
      toCurrencyId: "",
      rate: 1,
      effectiveDate: "",
      notes: "",
    },
  });

  const load = useCallback(async () => {
    try {
      const [rateRows, runRows, settings] = await Promise.all([
        exchangeRatesService.list(),
        fxRevaluationsService.list().catch(() => [] as FxRevaluationRunRow[]),
        accountingSettingsService.get().catch(() => null),
      ]);
      setBaseCurrencyId(settings ? settings.functionalCurrencyId : null);
      setRates(rateRows);
      setRuns(runRows);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : t("errors.generic"));
    }
  }, [t]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const codeOf = (id: string | null | undefined) =>
    currencies.find((currency) => currency.id === id)?.code ?? "";
  const baseCode = codeOf(baseCurrencyId);
  const [fromId, toId, rateValue] = useWatch({
    control: form.control,
    name: ["fromCurrencyId", "toCurrencyId", "rate"],
  });
  const rateNumber = Number(rateValue);
  const ratePreview =
    fromId && toId && rateNumber > 0
      ? t("accounting.fx.ratePreview", {
          from: codeOf(fromId),
          to: codeOf(toId),
          rate: String(rateNumber),
          inverse: String(Math.round((1 / rateNumber) * 1_000_000) / 1_000_000),
        })
      : null;

  const openRateForm = () => {
    form.reset({
      fromCurrencyId: "",
      toCurrencyId: baseCurrencyId ?? "",
      rate: 1,
      effectiveDate: "",
      notes: "",
    });
    setRateOpen(true);
  };

  const currencyOptions = currencies.map((currency) => ({
    value: currency.id,
    label: `${currency.code} — ${currency.name}`,
  }));

  const handleCreateRate = form.handleSubmit(async (values) => {
    setBusy(true);
    try {
      await exchangeRatesService.create(values);
      toast.success(t("accounting.fx.toasts.rateCreated"));
      form.reset();
      setRateOpen(false);
      await load();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : t("errors.generic"));
    } finally {
      setBusy(false);
    }
  });

  const handleRevalue = async () => {
    if (!rateDate) return;
    setBusy(true);
    try {
      await fxRevaluationsService.run({ rateDate: toISODate(rateDate) ?? "" });
      toast.success(t("accounting.fx.toasts.revalued"));
      setRevalueOpen(false);
      await load();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : t("errors.generic"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <PageWorkspace
      title={t("accounting.fx.title")}
      description={t("accounting.fx.description")}
      actions={
        <div className="flex flex-wrap gap-2">
          {canCreateRate && (
            <EnterpriseButton type="button" size="sm" onClick={openRateForm}>
              {t("accounting.fx.addRate")}
            </EnterpriseButton>
          )}
          {canRevalue && (
            <EnterpriseButton
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => setRevalueOpen(true)}
            >
              {t("accounting.fx.runRevaluation")}
            </EnterpriseButton>
          )}
        </div>
      }
    >
      {baseCurrencyId !== undefined ? (
        <Alert tone={baseCurrencyId ? "info" : "warning"} className="mb-3">
          <AlertDescription>
            {baseCurrencyId
              ? t("accounting.fx.baseCurrencyNote", { base: baseCode })
              : t("accounting.fx.baseCurrencyMissing")}
          </AlertDescription>
        </Alert>
      ) : null}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <EnterpriseCard className="gap-0 py-3">
          <EnterpriseCardHeader className="px-4 pb-2">
            <EnterpriseCardTitle className="text-body">
              {t("accounting.fx.rates")}
            </EnterpriseCardTitle>
          </EnterpriseCardHeader>
          <EnterpriseCardContent className="overflow-x-auto px-4">
            <table className="w-full text-caption">
              <thead>
                <tr className="border-b text-muted-foreground">
                  <th className="py-2 text-start">{t("accounting.fx.fields.effectiveDate")}</th>
                  <th className="py-2 text-start">{t("accounting.fx.fields.fromCurrency")}</th>
                  <th className="py-2 text-start">{t("accounting.fx.fields.toCurrency")}</th>
                  <th className="py-2 text-end">{t("accounting.fx.fields.rate")}</th>
                </tr>
              </thead>
              <tbody>
                {rates.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="py-6 text-center text-muted-foreground">
                      {t("common.noDataAvailable")}
                    </td>
                  </tr>
                ) : (
                  rates.map((row) => (
                    <tr key={row.id} className="border-b last:border-0">
                      <td className="py-2">{formatDate(row.effectiveDate)}</td>
                      <td className="py-2">{row.fromCurrency?.code ?? row.fromCurrencyId}</td>
                      <td className="py-2">{row.toCurrency?.code ?? row.toCurrencyId}</td>
                      <td className="py-2 text-end tabular-nums" dir="ltr">
                        {`1 ${row.fromCurrency?.code ?? ""} = ${Number(row.rate)} ${row.toCurrency?.code ?? ""}`}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </EnterpriseCardContent>
        </EnterpriseCard>

        <EnterpriseCard className="gap-0 py-3">
          <EnterpriseCardHeader className="px-4 pb-2">
            <EnterpriseCardTitle className="text-body">
              {t("accounting.fx.runs")}
            </EnterpriseCardTitle>
          </EnterpriseCardHeader>
          <EnterpriseCardContent className="overflow-x-auto px-4">
            <table className="w-full text-caption">
              <thead>
                <tr className="border-b text-muted-foreground">
                  <th className="py-2 text-start">{t("accounting.fx.fields.rateDate")}</th>
                  <th className="py-2 text-start">{t("masterData.fields.code")}</th>
                  <th className="py-2 text-start">{t("accounting.fx.fields.status")}</th>
                </tr>
              </thead>
              <tbody>
                {runs.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="py-6 text-center text-muted-foreground">
                      {t("common.noDataAvailable")}
                    </td>
                  </tr>
                ) : (
                  runs.map((row) => (
                    <tr key={row.id} className="border-b last:border-0">
                      <td className="py-2">{formatDate(row.rateDate)}</td>
                      <td className="py-2">{row.runNumber}</td>
                      <td className="py-2">
                        <StatusBadge
                          label={t(`accounting.lifecycleStatus.${row.status}` as MessageKey)}
                          tone={row.status === "POSTED" ? "success" : "neutral"}
                        />
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </EnterpriseCardContent>
        </EnterpriseCard>
      </div>

      <EnterpriseModal
        open={rateOpen}
        onOpenChange={setRateOpen}
        title={t("accounting.fx.addRate")}
        isDirty={form.formState.isDirty}
        footer={(requestClose) => (
          <>
            <EnterpriseButton type="button" variant="secondary" onClick={requestClose}>
              {t("common.cancel")}
            </EnterpriseButton>
            <EnterpriseButton type="button" disabled={busy} onClick={() => void handleCreateRate()}>
              {t("common.save")}
            </EnterpriseButton>
          </>
        )}
      >
        <MasterDataForm
          form={form}
          sectionTitle={t("accounting.fx.addRate")}
          fields={[
            {
              name: "fromCurrencyId",
              label: "accounting.fx.fields.fromCurrency",
              type: "select",
              required: true,
              options: currencyOptions,
            },
            {
              name: "toCurrencyId",
              label: "accounting.fx.fields.toCurrency",
              type: "select",
              required: true,
              options: currencyOptions,
            },
            {
              name: "rate",
              label: "accounting.fx.fields.rate",
              type: "number",
              required: true,
            },
            {
              name: "effectiveDate",
              label: "accounting.fx.fields.effectiveDate",
              type: "date",
              required: true,
            },
            { name: "notes", label: "masterData.fields.notes", type: "textarea" },
          ]}
        />
        {ratePreview ? (
          <p className="mt-2 text-caption text-muted-foreground" data-testid="fx-rate-preview">
            {ratePreview}
          </p>
        ) : null}
      </EnterpriseModal>

      <ConfirmationDialog
        open={revalueOpen}
        onOpenChange={setRevalueOpen}
        title={t("accounting.fx.runRevaluation")}
        extra={
          <div className="flex flex-col gap-1.5 px-6">
            <label className="text-caption text-muted-foreground">
              {t("accounting.fx.fields.rateDate")}
            </label>
            <EnterpriseDatePicker
              value={rateDate ?? null}
              onChange={(date) => setRateDate(date ?? undefined)}
            />
          </div>
        }
        confirmLabel={t("accounting.fx.runRevaluation")}
        confirmDisabled={!rateDate}
        isConfirming={busy}
        onConfirm={() => void handleRevalue()}
      />
    </PageWorkspace>
  );
}

export default function ExchangeRatesPage() {
  return (
    <PermissionGate permission="exchange-rates.view">
      <FxPageContent />
    </PermissionGate>
  );
}
