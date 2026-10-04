"use client";

import { useCallback, useEffect, useState } from "react";
import { z } from "zod";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { PageWorkspace } from "@/components/shared/page-workspace";
import { HeaderActions } from "@/components/shared/header-actions";
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
  fxSyncService,
  type ExchangeRateRow,
  type FxRevaluationRunRow,
  type FxSyncRunRow,
  type FxSyncStatus,
} from "@/services/fx-service";
import { FxAutoImportCard } from "@/components/finance/fx/fx-auto-import-card";
import { FxStaleBanner } from "@/components/finance/fx/fx-stale-banner";
import { FxRateLookupCard } from "@/components/finance/fx/fx-rate-lookup-card";
import { FxOverridesCard } from "@/components/finance/fx/fx-overrides-card";
import { FxRatesTable } from "@/components/finance/fx/fx-rates-table";
import {
  CompactDetailTable,
  type CompactDetailColumn,
} from "@/components/shared/data-table/compact-detail-table";
import { tableIdentityCellClass } from "@/components/ui/table";
import { accountingSettingsService } from "@/services/accounting-settings-service";
import { useCurrencies } from "@/hooks/use-reference-data";
import { useLocale } from "@/providers/locale-provider";
import { useUserContext } from "@/providers/user-context";
import { reportApiError, toast } from "@/lib/toast";
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
  const canManageFx = hasPermission("exchange-rates.manage");

  const [rates, setRates] = useState<ExchangeRateRow[]>([]);
  const [runs, setRuns] = useState<FxRevaluationRunRow[]>([]);
  const [syncStatus, setSyncStatus] = useState<FxSyncStatus | null>(null);
  const [syncRuns, setSyncRuns] = useState<FxSyncRunRow[]>([]);
  const [syncReceivedAt, setSyncReceivedAt] = useState(0);
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
      const [rateRows, runRows, settings, status, recentSyncRuns] = await Promise.all([
        exchangeRatesService.list(),
        fxRevaluationsService.list().catch(() => [] as FxRevaluationRunRow[]),
        accountingSettingsService.get().catch(() => null),
        fxSyncService.status().catch(() => null),
        fxSyncService.runs(15).catch(() => [] as FxSyncRunRow[]),
      ]);
      setBaseCurrencyId(settings ? settings.functionalCurrencyId : null);
      setRates(rateRows);
      setRuns(runRows);
      setSyncStatus(status);
      setSyncReceivedAt(Date.now());
      setSyncRuns(recentSyncRuns);
    } catch (error) {
      reportApiError(error, "errors.generic");
    }
  }, []);

  /** Status + run history only — polled while an import is running. */
  const refreshSync = useCallback(async () => {
    const [status, recentSyncRuns] = await Promise.all([
      fxSyncService.status().catch(() => null),
      fxSyncService.runs(15).catch(() => null),
    ]);
    if (status) {
      setSyncStatus(status);
      setSyncReceivedAt(Date.now());
    }
    if (recentSyncRuns) setSyncRuns(recentSyncRuns);
  }, []);

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

  // Canonical quotation only: 1 FOREIGN = X base — the base is never a "from" currency.
  const currencyOptions = currencies
    .filter((currency) => currency.id !== baseCurrencyId)
    .map((currency) => ({
      value: currency.id,
      label: `${currency.code} — ${currency.name}`,
    }));
  const baseOption = currencies
    .filter((currency) => currency.id === baseCurrencyId)
    .map((currency) => ({ value: currency.id, label: `${currency.code} — ${currency.name}` }));

  const handleCreateRate = form.handleSubmit(async (values) => {
    setBusy(true);
    try {
      await exchangeRatesService.create(values);
      toast.success(t("accounting.fx.toasts.rateCreated"));
      form.reset();
      setRateOpen(false);
      await load();
    } catch (error) {
      reportApiError(error, "errors.generic");
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
      reportApiError(error, "errors.generic");
    } finally {
      setBusy(false);
    }
  };

  const runColumns: CompactDetailColumn<FxRevaluationRunRow>[] = [
    {
      id: "rateDate",
      header: t("accounting.fx.fields.rateDate"),
      cell: (row) => <span className="num">{formatDate(row.rateDate)}</span>,
    },
    {
      id: "runNumber",
      header: t("masterData.fields.code"),
      cell: (row) => <span className={`num ${tableIdentityCellClass}`}>{row.runNumber}</span>,
    },
    {
      id: "status",
      header: t("accounting.fx.fields.status"),
      cell: (row) => (
        <StatusBadge
          label={t(`accounting.lifecycleStatus.${row.status}` as MessageKey)}
          tone={row.status === "POSTED" ? "success" : "neutral"}
        />
      ),
    },
  ];

  return (
    <PageWorkspace
      title={t("accounting.fx.title")}
      description={t("accounting.fx.description")}
      actions={
        <HeaderActions
          secondary={[
            {
              key: "revalue",
              label: t("accounting.fx.runRevaluation"),
              hidden: !canRevalue,
              onSelect: () => setRevalueOpen(true),
            },
          ]}
          primary={{
            key: "add-rate",
            label: t("accounting.fx.addRate"),
            hidden: !(canCreateRate && baseCurrencyId),
            onSelect: openRateForm,
          }}
        />
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
      <FxStaleBanner status={syncStatus} />
      <div className="mb-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
        <FxAutoImportCard
          status={syncStatus}
          statusReceivedAt={syncReceivedAt}
          runs={syncRuns}
          baseCode={baseCode}
          canManage={canManageFx}
          onChanged={load}
          onPoll={refreshSync}
        />
        <div className="flex min-w-0 flex-col gap-4">
          <FxRateLookupCard />
          <FxOverridesCard
            canManage={canManageFx && Boolean(baseCurrencyId)}
            baseCurrencyId={baseCurrencyId ?? null}
            baseCode={baseCode}
          />
        </div>
      </div>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <EnterpriseCard className="gap-0 py-3">
          <EnterpriseCardHeader className="px-4 pb-2">
            <EnterpriseCardTitle>{t("accounting.fx.rates")}</EnterpriseCardTitle>
          </EnterpriseCardHeader>
          <EnterpriseCardContent className="px-4">
            <FxRatesTable rates={rates} />
          </EnterpriseCardContent>
        </EnterpriseCard>

        <EnterpriseCard className="gap-0 py-3">
          <EnterpriseCardHeader className="px-4 pb-2">
            <EnterpriseCardTitle>{t("accounting.fx.runs")}</EnterpriseCardTitle>
          </EnterpriseCardHeader>
          <EnterpriseCardContent className="px-4">
            <CompactDetailTable
              columns={runColumns}
              rows={runs}
              rowKey={(row) => row.id}
              viewId="finance-exchange-rate-runs"
              empty={t("common.noDataAvailable")}
            />
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
            <EnterpriseButton type="button" variant="outline" onClick={requestClose}>
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
              options: baseOption,
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
        <p className="mt-2 text-caption text-muted-foreground">
          {t("fxSettings.addRate.canonicalNote", { base: baseCode })}
        </p>
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
