"use client";

import { useMemo, useState, type ReactNode } from "react";
import { BadgeCheck, Calculator, CalendarX, HandCoins, Info, Scale, Wallet } from "lucide-react";
import { EnterpriseDataTable } from "@/components/master-data/enterprise-data-table";
import {
  CompactDetailTable,
  type CompactDetailColumn,
} from "@/components/shared/data-table/compact-detail-table";
import { EnterpriseModal } from "@/components/shared/enterprise-modal";
import { InsightCard, InsightGroup, InsightScope } from "@/components/shared/insight-card";
import { SummaryCard } from "@/components/agents/summary-card";
import { ReportMoney } from "@/components/accounting/financial-report/report-money";
import { EntityTabs, type EntityTab } from "@/components/business/entity-tabs";
import { EnterpriseBadge } from "@/components/ui/badge";
import { useLocale } from "@/providers/locale-provider";
import { formatDate } from "@/lib/date";
import type {
  PartnershipState,
  PeriodStatement,
  StatementAdjustmentRow,
  StatementPeriodRow,
  StatementSegment,
} from "@/services/company-partners-service";
import { percentText } from "./format";
import { isApproved } from "./period-statement";
import {
  PeriodStatusBadge,
  buildAdjustmentColumns,
  buildPeriodColumns,
  statementPeriodName,
} from "./statement-columns";
import { ltrIsolate } from "@/lib/bidi";

/** A period's own adjustments, as the detail dialog lists them. */
export interface PeriodAdjustmentLine {
  date: string;
  reason: string;
  amount: number;
}

/**
 * One period's calculation (spec-w4 §5): status, entitlement → approved due →
 * paid → remaining, each segment's terms and the profit lines its basis used,
 * and the adjustments posted to it. Read-only, the same for staff and the
 * partner.
 */
export function PeriodDetailDialog({
  row,
  adjustments,
  currency,
  onClose,
}: {
  row: StatementPeriodRow | null;
  adjustments: PeriodAdjustmentLine[];
  currency: string;
  onClose: () => void;
}) {
  const { t, locale } = useLocale();
  const context = { t, locale };

  const segmentColumns = useMemo<CompactDetailColumn<StatementSegment>[]>(
    () => [
      {
        id: "dates",
        header: t("companyPartners.statement.fields.period"),
        cell: (segment) => (
          <span className="num">
            {formatDate(segment.from)} – {formatDate(segment.to)}
          </span>
        ),
      },
      {
        id: "terms",
        header: t("companyPartners.statement.fields.terms"),
        cell: (segment) =>
          `${percentText(segment.percent)} · ${t(`companyPartners.basis.${segment.basis}`)}`,
      },
      {
        id: "revenue",
        header: t("companyPartners.statement.fields.revenue"),
        align: "end",
        cell: (segment) => <ReportMoney value={segment.profitBase.netRevenue} />,
      },
      {
        id: "cost",
        header: t("companyPartners.statement.fields.costOfSales"),
        align: "end",
        cell: (segment) => <ReportMoney value={segment.profitBase.costOfSales} />,
      },
      {
        id: "other",
        header: t("companyPartners.statement.fields.otherExpenses"),
        align: "end",
        cell: (segment) => <ReportMoney value={segment.profitBase.otherExpensesNet} />,
      },
      {
        id: "profit",
        header: t("companyPartners.statement.fields.profitUsed"),
        align: "end",
        cell: (segment) => (
          <ReportMoney value={segment.profitBase.profit} adverse={segment.profitBase.profit < 0} />
        ),
      },
      {
        id: "share",
        header: t("companyPartners.statement.fields.share"),
        align: "end",
        cell: (segment) =>
          segment.lossClamped ? (
            <span className="text-caption text-muted-foreground">
              {t("companyPartners.statement.lossNote")}
            </span>
          ) : (
            <ReportMoney value={segment.amount} />
          ),
      },
    ],
    [t],
  );

  const adjustmentColumns = useMemo<CompactDetailColumn<PeriodAdjustmentLine>[]>(
    () => [
      {
        id: "date",
        header: t("companyPartners.statement.fields.date"),
        cell: (line) => <span className="num">{formatDate(line.date)}</span>,
      },
      {
        id: "reason",
        header: t("companyPartners.statement.fields.reason"),
        cell: (line) => line.reason,
      },
      {
        id: "amount",
        header: t("companyPartners.statement.fields.amount"),
        align: "end",
        cell: (line) => <ReportMoney value={line.amount} adverse={line.amount < 0} />,
      },
    ],
    [t],
  );

  if (!row) return null;
  const approved = isApproved(row);
  return (
    <EnterpriseModal
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      size="lg"
      title={statementPeriodName(row, context)}
      description={`${formatDate(row.periodFrom)} – ${formatDate(row.periodTo)}`}
    >
      <div className="flex min-w-0 flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <PeriodStatusBadge status={row.status} t={t} />
          {approved ? null : (
            <span className="text-caption text-muted-foreground">
              {t("companyPartners.statement.note")}
            </span>
          )}
        </div>
        <SummaryCard
          tone={approved ? "success" : "profit"}
          icon={approved ? BadgeCheck : Calculator}
          title={
            approved ? t("companyPartners.statement.approvedTag") : t("companyPartners.estimateTag")
          }
          currency={currency}
          rows={[
            { label: t("companyPartners.statement.fields.entitlement"), value: row.entitlement },
            ...(approved
              ? [
                  {
                    label: t("companyPartners.statement.fields.adjustments"),
                    value: row.adjustments,
                  },
                  {
                    label: t("companyPartners.statement.fields.approvedDue"),
                    value: row.approvedDue,
                  },
                  { label: t("companyPartners.statement.fields.paid"), value: row.paid },
                  {
                    label: t("companyPartners.statement.fields.remaining"),
                    value: row.remaining,
                    emphasis: true,
                  },
                ]
              : []),
          ]}
        />
        <section className="flex min-w-0 flex-col gap-1.5">
          <h3 className="text-caption font-semibold text-muted-foreground">
            {t("companyPartners.statement.segments")}
          </h3>
          <CompactDetailTable
            columns={segmentColumns}
            rows={row.segments}
            rowKey={(segment) => `${segment.from}-${segment.percent}`}
            stacked
          />
        </section>
        {adjustments.length > 0 ? (
          <section className="flex min-w-0 flex-col gap-1.5">
            <h3 className="text-caption font-semibold text-muted-foreground">
              {t("companyPartners.statement.adjustmentsTab")}
            </h3>
            <CompactDetailTable
              columns={adjustmentColumns}
              rows={adjustments}
              rowKey={(line) => `${line.date}-${line.reason}-${line.amount}`}
              stacked
            />
          </section>
        ) : null}
      </div>
    </EnterpriseModal>
  );
}

/**
 * 4.7 — after the last agreement's end date: the partnership has ended, its
 * history stays readable and nothing is deleted. Renders nothing otherwise.
 */
export function PartnershipEndedNotice({ partnership }: { partnership: PartnershipState }) {
  const { t } = useLocale();
  if (partnership.status !== "ENDED" || !partnership.endsOn) return null;
  return (
    <p
      role="status"
      className="flex items-start gap-2 rounded-md border border-border bg-muted px-3 py-2 text-caption"
    >
      <CalendarX className="mt-0.5 size-3.5 shrink-0" aria-hidden />
      {t("companyPartners.partnership.endedOn", {
        date: ltrIsolate(formatDate(partnership.endsOn)),
      })}
    </p>
  );
}

/**
 * The per-period statement (spec-w4 §5-6, D15-15) as both audiences see it:
 * an "ended" notice once the partnership is over, the estimate / approved
 * distinction, the range totals (estimated · approved due · paid · remaining)
 * beside the position to date (payable · advance), then tabs — one row per
 * closing period (cards on phones), the caller's payment history, the
 * adjustment history and any caller tabs. A row opens its calculation.
 */
export function PeriodStatementView({
  statement,
  isLoading,
  tableIdPrefix,
  payments,
  extraTabs = [],
}: {
  statement: PeriodStatement | null;
  isLoading: boolean;
  /** Prefix of the remembered table preferences (`company-partner` / `partner-portal`). */
  tableIdPrefix: string;
  /** The payment history — staff and the partner see different columns. */
  payments: ReactNode;
  extraTabs?: EntityTab[];
}) {
  const { t, locale } = useLocale();
  const [selected, setSelected] = useState<StatementPeriodRow | null>(null);
  const periodColumns = useMemo(() => buildPeriodColumns({ t, locale }, setSelected), [t, locale]);
  const adjustmentColumns = useMemo(() => buildAdjustmentColumns(), []);
  const currency = statement?.currency?.code ?? "";
  const money = (value: number) => <ReportMoney value={value} currency={currency} align="inline" />;
  const totals = statement?.totals;
  const position = statement?.position;
  const partnership = statement?.partnership;
  const selectedAdjustments: StatementAdjustmentRow[] = selected?.periodId
    ? (statement?.adjustments ?? []).filter((a) => a.periodId === selected.periodId)
    : [];

  return (
    <>
      {partnership ? <PartnershipEndedNotice partnership={partnership} /> : null}
      <p className="flex items-start gap-2 rounded-md border border-info-soft bg-info-soft px-3 py-2 text-caption text-info-soft-foreground">
        <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        {t("companyPartners.statement.note")}
      </p>

      {totals && position ? (
        <InsightGroup fit>
          <InsightCard
            icon={Calculator}
            tone="profit"
            label={t("companyPartners.statement.estimated")}
            value={money(totals.estimated)}
            amount={totals.estimated}
            meta={
              <EnterpriseBadge variant="outline" className="font-medium">
                {t("companyPartners.estimateTag")}
              </EnterpriseBadge>
            }
          />
          <InsightCard
            icon={BadgeCheck}
            tone="success"
            label={t("companyPartners.statement.approvedDue")}
            value={money(totals.approvedDue)}
            amount={totals.approvedDue}
            meta={
              <EnterpriseBadge variant="outline" className="font-medium">
                {t("companyPartners.statement.approvedTag")}
              </EnterpriseBadge>
            }
          />
          <InsightCard
            icon={HandCoins}
            tone="info"
            label={t("companyPartners.statement.paid")}
            value={money(totals.paid)}
            amount={totals.paid}
            meta={<InsightScope kind="period">{t("companyPartners.fields.period")}</InsightScope>}
          />
          <InsightCard
            icon={Scale}
            tone="warning"
            emphasis={totals.remaining > 0}
            label={t("companyPartners.statement.remaining")}
            value={money(totals.remaining)}
            amount={totals.remaining}
            meta={<InsightScope kind="period">{t("companyPartners.fields.period")}</InsightScope>}
          />
          <InsightCard
            icon={Wallet}
            tone="warning"
            label={t("companyPartners.statement.payableNow")}
            value={money(position.payable)}
            amount={position.payable}
            meta={
              <InsightScope kind="current">{t("companyPartners.sections.position")}</InsightScope>
            }
          />
          <InsightCard
            icon={Wallet}
            tone="destructive"
            label={t("companyPartners.statement.advanceNow")}
            value={money(position.advance)}
            amount={position.advance}
            meta={
              <InsightScope kind="current">{t("companyPartners.sections.position")}</InsightScope>
            }
          />
        </InsightGroup>
      ) : null}

      <EntityTabs
        tabs={[
          {
            value: "periods",
            label: t("companyPartners.statement.periodsTab"),
            content: (
              <EnterpriseDataTable
                tableId={`${tableIdPrefix}-statement-periods`}
                printTitle={t("companyPartners.statement.title")}
                columns={periodColumns}
                data={statement?.periods ?? []}
                isLoading={isLoading}
                getRowId={(row) => `${row.periodFrom}-${row.periodTo}`}
                emptyTitle={t("companyPartners.statement.noPeriods")}
              />
            ),
          },
          {
            value: "payments",
            label: t("companyPartners.statement.paymentsTab"),
            content: payments,
          },
          {
            value: "adjustments",
            label: t("companyPartners.statement.adjustmentsTab"),
            content: (
              <EnterpriseDataTable
                tableId={`${tableIdPrefix}-statement-adjustments`}
                columns={adjustmentColumns}
                data={statement?.adjustments ?? []}
                isLoading={isLoading}
                getRowId={(row, index) => `${row.periodId}-${row.date}-${index}`}
                emptyTitle={t("companyPartners.statement.noAdjustments")}
              />
            ),
          },
          ...extraTabs,
        ]}
      />

      <PeriodDetailDialog
        row={selected}
        adjustments={selectedAdjustments}
        currency={currency}
        onClose={() => setSelected(null)}
      />
    </>
  );
}
