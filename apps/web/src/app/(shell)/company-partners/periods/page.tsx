"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import {
  AlertTriangle,
  BarChart3,
  Building2,
  CheckCircle2,
  Eye,
  FilePen,
  Handshake,
  Info,
  Lock,
  Save,
  TrendingUp,
} from "lucide-react";
import { PageWorkspace } from "@/components/shared/page-workspace";
import { HeaderActions } from "@/components/shared/header-actions";
import { PermissionGate } from "@/components/shared/permission-gate";
import { EnterpriseDataTable } from "@/components/master-data/enterprise-data-table";
import {
  EnterpriseDateRangePicker,
  type DateRangeValue,
} from "@/components/shared/date-range-picker";
import { InsightCard, InsightGroup } from "@/components/shared/insight-card";
import { ReportMoney } from "@/components/accounting/financial-report/report-money";
import { JournalTraceCell } from "@/components/accounting/journal-trace-cell";
import { RowActionsMenu } from "@/components/shared/data-table";
import { ConfirmationDialog } from "@/components/shared/confirmation-dialog";
import { DetailSection } from "@/components/shared/detail-workspace";
import { StatusBadge } from "@/components/business/status-badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  PERIOD_TONE,
  incomeStatementHref,
  percentText,
  previousMonth,
} from "@/config/company-partners/format";
import {
  companyPartnersService,
  type PartnerProfitCalculation,
  type PartnerProfitPeriodRow,
} from "@/services/company-partners-service";
import { useLocale } from "@/providers/locale-provider";
import { useUserContext } from "@/providers/user-context";
import { formatDate, fromISODate, toISODate } from "@/lib/date";
import { apiErrorMessage, reportApiError, toast } from "@/lib/toast";
import type { MessageKey } from "@/i18n/translate";

/** One row per partner segment of the live estimate. */
interface PreviewRow {
  key: string;
  partnerName: string;
  partnerTotal: number;
  first: boolean;
  from: string;
  to: string;
  days: number;
  basis: "GROSS_PROFIT" | "NET_PROFIT";
  baseAmount: number;
  percent: number;
  amount: number;
  lossClamped: boolean;
}

const WARNING_KEY: Record<string, MessageKey> = {
  NO_AGREEMENTS: "companyPartners.periods.noAgreements",
  MIXED_FREQUENCY: "companyPartners.periods.mixedFrequency",
  NO_FUNCTIONAL_CURRENCY: "companyPartners.periods.noCurrency",
};

function PeriodsContent() {
  const { t } = useLocale();
  const router = useRouter();
  const { hasPermission } = useUserContext();
  const canClose = hasPermission("company-partners.close");
  const [range, setRange] = useState<DateRangeValue>(previousMonth);
  const [preview, setPreview] = useState<PartnerProfitCalculation | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [isPreviewing, setIsPreviewing] = useState(true);
  const [periods, setPeriods] = useState<PartnerProfitPeriodRow[]>([]);
  const [periodsError, setPeriodsError] = useState<string | null>(null);
  const [isLoadingPeriods, setIsLoadingPeriods] = useState(true);
  const [busy, setBusy] = useState(false);
  const [closing, setClosing] = useState<PartnerProfitPeriodRow | null>(null);
  const [adjusting, setAdjusting] = useState<PartnerProfitPeriodRow | null>(null);
  const [reason, setReason] = useState("");

  const from = range.from ? toISODate(range.from) : null;
  const to = range.to ? toISODate(range.to) : null;

  const loadPreview = useCallback(async () => {
    if (!from || !to) return;
    setIsPreviewing(true);
    setPreviewError(null);
    try {
      setPreview(await companyPartnersService.preview(from, to));
    } catch (error) {
      setPreview(null);
      setPreviewError(apiErrorMessage(error, "errors.loadFailed"));
    } finally {
      setIsPreviewing(false);
    }
  }, [from, to]);

  const loadPeriods = useCallback(async () => {
    setIsLoadingPeriods(true);
    setPeriodsError(null);
    try {
      setPeriods(await companyPartnersService.periods());
    } catch (error) {
      setPeriodsError(apiErrorMessage(error, "errors.loadFailed"));
    } finally {
      setIsLoadingPeriods(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadPreview();
  }, [loadPreview]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadPeriods();
  }, [loadPeriods]);

  const existing = periods.find((p) => p.periodFrom === from && p.periodTo === to) ?? null;
  const currency = preview?.currency?.code ?? null;

  const saveReview = async () => {
    if (!from || !to) return;
    setBusy(true);
    try {
      await companyPartnersService.saveReview(from, to);
      toast.success(t("companyPartners.toasts.reviewSaved"));
      await Promise.all([loadPeriods(), loadPreview()]);
    } catch (error) {
      reportApiError(error, "errors.saveFailed");
    } finally {
      setBusy(false);
    }
  };

  const closePeriod = async () => {
    if (!closing) return;
    setBusy(true);
    try {
      await companyPartnersService.closePeriod(closing.id);
      toast.success(t("companyPartners.toasts.periodClosed"));
      setClosing(null);
      await loadPeriods();
    } catch (error) {
      reportApiError(error, "errors.saveFailed");
    } finally {
      setBusy(false);
    }
  };

  const adjustPeriod = async () => {
    if (!adjusting || !reason.trim()) return;
    setBusy(true);
    try {
      await companyPartnersService.adjustPeriod(adjusting.id, reason.trim());
      toast.success(t("companyPartners.toasts.adjusted"));
      setAdjusting(null);
      await loadPeriods();
    } catch (error) {
      reportApiError(error, "errors.saveFailed");
    } finally {
      setBusy(false);
    }
  };

  const previewRows = useMemo<PreviewRow[]>(
    () =>
      (preview?.partners ?? []).flatMap((partner) =>
        partner.segments.map((segment, index) => ({
          key: `${partner.partnerId}-${segment.agreementId}-${segment.from}`,
          partnerName: partner.partnerName,
          partnerTotal: partner.amount,
          first: index === 0,
          from: segment.from,
          to: segment.to,
          days: segment.days,
          basis: segment.basis,
          baseAmount: segment.baseAmount,
          percent: segment.percent,
          amount: segment.amount,
          lossClamped: segment.lossClamped,
        })),
      ),
    [preview],
  );

  const previewColumns = useMemo<ColumnDef<PreviewRow, unknown>[]>(
    () => [
      {
        id: "partner",
        accessorFn: (row) => row.partnerName,
        meta: {
          titleKey: "companyPartners.fields.partner",
          type: "name",
          identity: true,
          importance: "critical",
        },
        cell: ({ row }) => (
          <span className={row.original.first ? "font-medium" : "text-muted-foreground"}>
            {row.original.partnerName}
          </span>
        ),
      },
      {
        id: "from",
        accessorFn: (row) => row.from,
        meta: { titleKey: "companyPartners.fields.from", type: "date" },
        cell: ({ row }) => <span className="num">{formatDate(row.original.from)}</span>,
      },
      {
        id: "to",
        accessorFn: (row) => row.to,
        meta: { titleKey: "companyPartners.fields.to", type: "date" },
        cell: ({ row }) => <span className="num">{formatDate(row.original.to)}</span>,
      },
      {
        id: "days",
        accessorFn: (row) => row.days,
        meta: { titleKey: "companyPartners.fields.days", type: "number", importance: "low" },
      },
      {
        id: "basis",
        accessorFn: (row) => row.basis,
        meta: {
          titleKey: "companyPartners.fields.basis",
          type: "default",
          importance: "medium",
          displayValue: (row, tr) => tr(`companyPartners.basis.${row.basis}`),
        },
        cell: ({ row }) => t(`companyPartners.basis.${row.original.basis}`),
      },
      {
        id: "base",
        accessorFn: (row) => row.baseAmount,
        meta: { titleKey: "companyPartners.fields.base", type: "money", importance: "high" },
        cell: ({ row }) => (
          <ReportMoney value={row.original.baseAmount} adverse={row.original.baseAmount < 0} />
        ),
      },
      {
        id: "percent",
        accessorFn: (row) => row.percent,
        meta: {
          titleKey: "companyPartners.fields.percent",
          type: "percent",
          displayValue: (row) => percentText(row.percent),
        },
        cell: ({ row }) => <span className="num">{percentText(row.original.percent)}</span>,
      },
      {
        id: "amount",
        accessorFn: (row) => row.amount,
        meta: { titleKey: "companyPartners.fields.amount", type: "money", importance: "critical" },
        cell: ({ row }) =>
          row.original.lossClamped ? (
            <span className="text-caption text-muted-foreground">
              {t("companyPartners.fields.lossNote")}
            </span>
          ) : (
            <ReportMoney value={row.original.amount} />
          ),
      },
    ],
    [t],
  );

  const periodColumns = useMemo<ColumnDef<PartnerProfitPeriodRow, unknown>[]>(
    () => [
      {
        id: "period",
        accessorFn: (row) => row.periodFrom,
        meta: {
          titleKey: "companyPartners.fields.period",
          type: "date",
          identity: true,
          importance: "critical",
          displayValue: (row) => `${row.periodFrom} → ${row.periodTo}`,
        },
        cell: ({ row }) => (
          <span className="num">
            {formatDate(row.original.periodFrom)} – {formatDate(row.original.periodTo)}
          </span>
        ),
      },
      {
        id: "frequency",
        accessorFn: (row) => row.frequency,
        meta: {
          titleKey: "companyPartners.fields.frequency",
          type: "default",
          importance: "low",
          displayValue: (row, tr) => tr(`companyPartners.frequency.${row.frequency}`),
        },
        cell: ({ row }) => t(`companyPartners.frequency.${row.original.frequency}`),
      },
      {
        id: "status",
        accessorFn: (row) => row.status,
        meta: {
          titleKey: "companyPartners.fields.status",
          type: "status",
          displayValue: (row, tr) => tr(`companyPartners.periodStatus.${row.status}`),
        },
        cell: ({ row }) => (
          <StatusBadge
            label={t(`companyPartners.periodStatus.${row.original.status}`)}
            tone={PERIOD_TONE[row.original.status]}
            icon={row.original.status === "CLOSED" ? Lock : FilePen}
          />
        ),
      },
      {
        id: "original",
        accessorFn: (row) => row.originalTotal,
        meta: { titleKey: "companyPartners.fields.original", type: "money" },
        cell: ({ row }) => <ReportMoney value={row.original.originalTotal} />,
      },
      {
        id: "adjustments",
        accessorFn: (row) => row.adjustmentTotal,
        meta: {
          titleKey: "companyPartners.fields.adjustments",
          type: "money",
          importance: "medium",
        },
        cell: ({ row }) => <ReportMoney value={row.original.adjustmentTotal} />,
      },
      {
        id: "total",
        accessorFn: (row) => row.total,
        meta: { titleKey: "companyPartners.fields.total", type: "money", importance: "critical" },
        cell: ({ row }) => <ReportMoney value={row.original.total} />,
      },
      {
        id: "journal",
        meta: { titleKey: "companyPartners.fields.journalEntry", type: "reference" },
        cell: ({ row }) =>
          row.original.status === "CLOSED" ? (
            <JournalTraceCell
              sourceType="PARTNER_PROFIT_DISTRIBUTION"
              sourceId={row.original.id}
              expected={row.original.originalTotal !== 0}
            />
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
      },
      {
        id: "actions",
        meta: { type: "actions" },
        cell: ({ row }) => (
          <RowActionsMenu
            label={t("common.actions")}
            actions={[
              {
                key: "open",
                label: t("companyPartners.periods.open"),
                icon: Eye,
                onSelect: () =>
                  setRange({
                    from: fromISODate(row.original.periodFrom),
                    to: fromISODate(row.original.periodTo),
                  }),
              },
              {
                key: "incomeStatement",
                label: t("companyPartners.links.incomeStatement"),
                icon: BarChart3,
                onSelect: () =>
                  router.push(incomeStatementHref(row.original.periodFrom, row.original.periodTo)),
              },
              {
                key: "close",
                label: t("companyPartners.periods.close"),
                icon: Lock,
                hidden: !canClose || row.original.status !== "PREVIEW",
                onSelect: () => setClosing(row.original),
              },
              {
                key: "adjust",
                label: t("companyPartners.periods.adjust"),
                icon: FilePen,
                hidden: !canClose || row.original.status !== "CLOSED",
                onSelect: () => {
                  setReason("");
                  setAdjusting(row.original);
                },
              },
            ]}
          />
        ),
      },
    ],
    [t, canClose, router],
  );

  const netProfit = preview?.figures.netProfit ?? 0;
  const total = preview?.totalEntitlement ?? 0;

  return (
    <PageWorkspace
      title={t("companyPartners.periods.title")}
      description={t("companyPartners.periods.description")}
      actions={
        <HeaderActions
          primary={{
            key: "review",
            label:
              existing?.status === "PREVIEW"
                ? t("companyPartners.periods.refreshReview")
                : t("companyPartners.periods.saveReview"),
            icon: Save,
            hidden: !canClose || existing?.status === "CLOSED",
            disabled: busy || !preview || preview.partners.length === 0,
            loading: busy,
            onSelect: () => void saveReview(),
          }}
          secondary={[
            {
              key: "close",
              label: t("companyPartners.periods.close"),
              icon: Lock,
              hidden: !canClose || existing?.status !== "PREVIEW",
              onSelect: () => {
                if (existing) setClosing(existing);
              },
            },
            {
              key: "partners",
              label: t("companyPartners.title"),
              icon: Handshake,
              href: "/company-partners",
            },
          ]}
          inline={<EnterpriseDateRangePicker value={range} onChange={setRange} />}
        />
      }
    >
      <p className="flex items-start gap-2 rounded-md border border-info-soft bg-info-soft px-3 py-2 text-caption text-info-soft-foreground">
        <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        {t("companyPartners.estimateNote")} {t("companyPartners.periods.windowHint")}
      </p>

      {preview?.warnings.length ? (
        <ul className="flex flex-col gap-1 rounded-md border border-warning/40 bg-warning/5 px-3 py-2 text-caption text-warning-foreground">
          {preview.warnings.map((code) => (
            <li key={code} className="flex items-center gap-2">
              <AlertTriangle className="size-3.5 shrink-0" aria-hidden />
              {WARNING_KEY[code] ? t(WARNING_KEY[code]) : code}
            </li>
          ))}
        </ul>
      ) : null}

      <DetailSection
        title={`${t("companyPartners.periods.preview")} — ${t("companyPartners.estimateTag")}`}
      >
        {preview ? (
          <InsightGroup className="grid-cols-2 md:grid-cols-3 xl:grid-cols-5">
            <InsightCard
              icon={TrendingUp}
              tone="revenue"
              label={t("companyPartners.fields.revenue")}
              value={
                <ReportMoney
                  value={preview.figures.netRevenue}
                  currency={currency}
                  align="inline"
                />
              }
              amount={preview.figures.netRevenue}
              href={from && to ? incomeStatementHref(from, to) : undefined}
              actionLabel={t("companyPartners.links.incomeStatement")}
            />
            <InsightCard
              icon={BarChart3}
              tone="profit"
              label={t("companyPartners.fields.grossProfit")}
              value={
                <ReportMoney
                  value={preview.figures.grossProfit}
                  currency={currency}
                  align="inline"
                />
              }
              amount={preview.figures.grossProfit}
            />
            <InsightCard
              icon={netProfit < 0 ? AlertTriangle : CheckCircle2}
              tone={netProfit < 0 ? "loss" : "profit"}
              label={t("companyPartners.fields.netProfit")}
              value={
                <ReportMoney
                  value={netProfit}
                  currency={currency}
                  align="inline"
                  adverse={netProfit < 0}
                />
              }
              amount={netProfit}
            />
            <InsightCard
              icon={Handshake}
              tone="warning"
              emphasis={total > 0}
              label={t("companyPartners.summary.estimated")}
              value={<ReportMoney value={total} currency={currency} align="inline" />}
              amount={total}
            />
            <InsightCard
              icon={Building2}
              tone="info"
              label={t("companyPartners.summary.companyRetained")}
              value={
                <ReportMoney
                  value={Math.round((netProfit - total) * 100) / 100}
                  currency={currency}
                  align="inline"
                />
              }
              amount={netProfit - total}
              context={t("companyPartners.fields.netProfit")}
            />
          </InsightGroup>
        ) : null}
        <div className="mt-3">
          <EnterpriseDataTable
            tableId="company-partner-preview"
            printTitle={`${t("companyPartners.periods.preview")} ${from ?? ""} → ${to ?? ""}`}
            columns={previewColumns}
            data={previewRows}
            isLoading={isPreviewing}
            error={previewError}
            onRetry={() => void loadPreview()}
            onRefresh={() => void loadPreview()}
            getRowId={(row) => row.key}
            emptyTitle={t("companyPartners.periods.noAgreements")}
          />
        </div>
      </DetailSection>

      <DetailSection title={t("companyPartners.periods.list")}>
        <EnterpriseDataTable
          tableId="company-partner-periods"
          printTitle={t("companyPartners.periods.list")}
          columns={periodColumns}
          data={periods}
          isLoading={isLoadingPeriods}
          error={periodsError}
          onRetry={() => void loadPeriods()}
          onRefresh={() => void loadPeriods()}
          getRowId={(row) => row.id}
          emptyTitle={t("companyPartners.periods.empty")}
        />
      </DetailSection>

      <ConfirmationDialog
        open={Boolean(closing)}
        onOpenChange={(open) => {
          if (!open) setClosing(null);
        }}
        title={t("companyPartners.periods.closeTitle")}
        description={
          closing
            ? `${formatDate(closing.periodFrom)} – ${formatDate(closing.periodTo)} · ${t("companyPartners.periods.closeDescription")}`
            : undefined
        }
        tone="warning"
        confirmLabel={t("companyPartners.periods.close")}
        isConfirming={busy}
        onConfirm={() => void closePeriod()}
      />
      <ConfirmationDialog
        open={Boolean(adjusting)}
        onOpenChange={(open) => {
          if (!open) setAdjusting(null);
        }}
        title={t("companyPartners.periods.adjustTitle")}
        description={t("companyPartners.periods.adjustDescription")}
        tone="warning"
        confirmLabel={t("companyPartners.periods.adjust")}
        confirmDisabled={!reason.trim()}
        isConfirming={busy}
        onConfirm={() => void adjustPeriod()}
        extra={
          <div className="flex flex-col gap-1.5 px-6">
            <Label htmlFor="partner-adjust-reason">
              {t("companyPartners.fields.reason")} <span className="text-destructive">*</span>
            </Label>
            <Textarea
              id="partner-adjust-reason"
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
        }
      />
      <p className="text-caption text-muted-foreground">
        <Link
          href="/finance/accounting-settings"
          className="hover:underline focus-visible:underline"
        >
          {t("companyPartners.settings.sectionTitle")} — {t("companyPartners.settings.hint")}
        </Link>
      </p>
    </PageWorkspace>
  );
}

export default function CompanyPartnerPeriodsPage() {
  return (
    <PermissionGate permission="company-partners.view">
      <PeriodsContent />
    </PermissionGate>
  );
}
