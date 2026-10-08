"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { FileSearch, Undo2 } from "lucide-react";
import { RowActionsMenu } from "@/components/shared/data-table";
import { StatusBadge } from "@/components/business/status-badge";
import { ReportMoney } from "@/components/accounting/financial-report/report-money";
import { formatDate } from "@/lib/date";
import type { MessageKey } from "@/i18n/translate";
import type {
  StatementAdjustmentRow,
  StatementPeriodRow,
} from "@/services/company-partners-service";
import type { PortalPayment } from "@/services/partner-portal-service";
import { PERIOD_STATUS_TONE, periodName, periodTerms } from "./period-statement";

type Translate = (key: MessageKey, values?: Record<string, string | number>) => string;

export interface StatementColumnContext {
  t: Translate;
  locale: "ar" | "en";
}

/** "March 2026" / «مارس 2026», "Q1 2026", "2026" in the UI language. */
export function statementPeriodName(
  row: Pick<StatementPeriodRow, "periodFrom" | "frequency">,
  { t, locale }: StatementColumnContext,
): string {
  return periodName(row, locale, {
    quarter: (quarter, year) => t("companyPartners.statement.quarter", { quarter, year }),
  });
}

export function statementPeriodTerms(
  row: Pick<StatementPeriodRow, "segments">,
  { t }: StatementColumnContext,
): string {
  return periodTerms(row, (basis) => t(`companyPartners.basis.${basis}`));
}

/** Estimate / Under review / Approved — one badge vocabulary for both audiences. */
export function PeriodStatusBadge({
  status,
  t,
}: {
  status: StatementPeriodRow["status"];
  t: Translate;
}) {
  return (
    <StatusBadge
      label={t(`companyPartners.statement.status.${status}`)}
      tone={PERIOD_STATUS_TONE[status]}
    />
  );
}

/**
 * The per-period statement table (spec-w4 §5): period, status, terms,
 * calculated entitlement, approved due, paid, remaining. Approved-only
 * columns stay "—" for an estimate, so a provisional figure never reads as
 * approved. `onDetails` opens the period's calculation.
 */
export function buildPeriodColumns(
  context: StatementColumnContext,
  onDetails: (row: StatementPeriodRow) => void,
): ColumnDef<StatementPeriodRow, unknown>[] {
  const { t } = context;
  const money = (value: number | null) => <ReportMoney value={value} />;
  return [
    {
      id: "period",
      accessorFn: (row) => row.periodFrom,
      meta: {
        titleKey: "companyPartners.statement.fields.period",
        type: "name",
        identity: true,
        importance: "critical",
        stacked: true,
        displayValue: (row) => statementPeriodName(row, context),
      },
      cell: ({ row }) => (
        <span className="flex min-w-0 flex-col">
          <span className="font-medium">{statementPeriodName(row.original, context)}</span>
          <span className="num text-caption text-muted-foreground">
            {formatDate(row.original.periodFrom)} – {formatDate(row.original.periodTo)}
          </span>
        </span>
      ),
    },
    {
      id: "status",
      accessorFn: (row) => row.status,
      meta: {
        titleKey: "companyPartners.statement.fields.status",
        type: "status",
        importance: "critical",
        displayValue: (row, tr) => tr(`companyPartners.statement.status.${row.status}`),
      },
      cell: ({ row }) => <PeriodStatusBadge status={row.original.status} t={t} />,
    },
    {
      id: "terms",
      accessorFn: (row) => statementPeriodTerms(row, context),
      meta: {
        titleKey: "companyPartners.statement.fields.terms",
        type: "default",
        importance: "medium",
      },
    },
    {
      id: "entitlement",
      accessorFn: (row) => row.entitlement,
      meta: {
        titleKey: "companyPartners.statement.fields.entitlement",
        type: "money",
        importance: "high",
      },
      cell: ({ row }) => money(row.original.entitlement),
    },
    {
      id: "approvedDue",
      accessorFn: (row) => row.approvedDue,
      meta: {
        titleKey: "companyPartners.statement.fields.approvedDue",
        type: "money",
        importance: "critical",
      },
      cell: ({ row }) => money(row.original.approvedDue),
    },
    {
      id: "paid",
      accessorFn: (row) => row.paid,
      meta: {
        titleKey: "companyPartners.statement.fields.paid",
        type: "money",
        importance: "high",
      },
      cell: ({ row }) => money(row.original.paid),
    },
    {
      id: "remaining",
      accessorFn: (row) => row.remaining,
      meta: {
        titleKey: "companyPartners.statement.fields.remaining",
        type: "money",
        importance: "critical",
      },
      cell: ({ row }) => money(row.original.remaining),
    },
    {
      id: "actions",
      meta: { titleKey: "common.actions", type: "actions" },
      cell: ({ row }) => (
        <RowActionsMenu
          label={t("common.actions")}
          actions={[
            {
              key: "details",
              label: t("companyPartners.statement.details"),
              icon: FileSearch,
              onSelect: () => onDetails(row.original),
            },
          ]}
        />
      ),
    },
  ];
}

/** Adjustment history: date, period, reason, amount (spec-w4 §5). */
export function buildAdjustmentColumns(): ColumnDef<StatementAdjustmentRow, unknown>[] {
  return [
    {
      id: "date",
      accessorFn: (row) => row.date,
      meta: {
        titleKey: "companyPartners.statement.fields.date",
        type: "date",
        importance: "critical",
      },
      cell: ({ row }) => <span className="num">{formatDate(row.original.date)}</span>,
    },
    {
      id: "period",
      accessorFn: (row) => row.periodFrom,
      meta: {
        titleKey: "companyPartners.statement.fields.period",
        type: "default",
        importance: "high",
        displayValue: (row) => `${formatDate(row.periodFrom)} – ${formatDate(row.periodTo)}`,
      },
      cell: ({ row }) => (
        <span className="num">
          {formatDate(row.original.periodFrom)} – {formatDate(row.original.periodTo)}
        </span>
      ),
    },
    {
      id: "reason",
      accessorFn: (row) => row.reason,
      meta: {
        titleKey: "companyPartners.statement.fields.reason",
        type: "description",
        importance: "high",
        wrap: true,
      },
    },
    {
      id: "amount",
      accessorFn: (row) => row.amount,
      meta: {
        titleKey: "companyPartners.statement.fields.amount",
        type: "money",
        importance: "critical",
      },
      cell: ({ row }) => (
        <ReportMoney value={row.original.amount} adverse={row.original.amount < 0} />
      ),
    },
  ];
}

/** The partner's own payment history: number, date, method label, reference, amount, reversed. */
export function buildPortalPaymentColumns({
  t,
}: StatementColumnContext): ColumnDef<PortalPayment, unknown>[] {
  return [
    {
      id: "paymentNumber",
      accessorFn: (row) => row.paymentNumber,
      meta: {
        titleKey: "companyPartners.statement.fields.paymentNumber",
        type: "reference",
        identity: true,
        importance: "critical",
      },
    },
    {
      id: "date",
      accessorFn: (row) => row.date,
      meta: {
        titleKey: "companyPartners.statement.fields.date",
        type: "date",
        importance: "critical",
      },
      cell: ({ row }) => <span className="num">{formatDate(row.original.date)}</span>,
    },
    {
      id: "method",
      accessorFn: (row) => row.method,
      meta: {
        titleKey: "companyPartners.statement.fields.method",
        type: "default",
        importance: "medium",
        displayValue: (row, tr) => tr(`companyPartners.statement.method.${row.method}`),
      },
      cell: ({ row }) => t(`companyPartners.statement.method.${row.original.method}`),
    },
    {
      id: "reference",
      accessorFn: (row) => row.reference ?? "",
      meta: {
        titleKey: "companyPartners.statement.fields.reference",
        type: "reference",
        importance: "low",
      },
    },
    {
      id: "amount",
      accessorFn: (row) => row.amount,
      meta: {
        titleKey: "companyPartners.statement.fields.amount",
        type: "money",
        importance: "critical",
      },
      cell: ({ row }) => <ReportMoney value={row.original.amount} quiet={row.original.reversed} />,
    },
    {
      id: "status",
      accessorFn: (row) => (row.reversed ? "REVERSED" : "PAID"),
      meta: {
        titleKey: "companyPartners.statement.fields.status",
        type: "status",
        displayValue: (row, tr) =>
          row.reversed
            ? tr("companyPartners.statement.reversed")
            : tr("companyPartners.fields.paid"),
      },
      cell: ({ row }) =>
        row.original.reversed ? (
          <StatusBadge
            label={t("companyPartners.statement.reversed")}
            tone="neutral"
            icon={Undo2}
          />
        ) : (
          <StatusBadge label={t("companyPartners.fields.paid")} tone="success" />
        ),
    },
  ];
}
