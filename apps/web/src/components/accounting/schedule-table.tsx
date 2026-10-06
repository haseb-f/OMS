"use client";

import { StatusBadge } from "@/components/business/status-badge";
import type { StatusTone } from "@/components/business/status-tone";
import {
  CompactDetailTable,
  type CompactDetailColumn,
} from "@/components/shared/data-table/compact-detail-table";
import { MoneyValue } from "@/components/shared/money-value";
import { RelatedRecordLink } from "@/components/shared/record-preview";
import { formatDate } from "@/lib/date";
import { useLocale } from "@/providers/locale-provider";
import type {
  ScheduleRow,
  ScheduleRowStatus,
  SchedulePreviewRow,
} from "@/services/accounting-schedules-service";

/**
 * Schedule row status. A PENDING row whose last automatic attempt failed
 * (locked period, missing mapping) reads "Not posted" in warning — the
 * reason is in the row's last-error column.
 */
export function ScheduleStatusBadge({
  status,
  failed = false,
}: {
  status: ScheduleRowStatus;
  failed?: boolean;
}) {
  const { t } = useLocale();
  const tone: StatusTone =
    status === "POSTED"
      ? "success"
      : failed
        ? "warning"
        : status === "CANCELLED"
          ? "neutral"
          : "info";
  return (
    <StatusBadge
      label={t(
        failed && status === "PENDING"
          ? "assetSchedules.status.FAILED"
          : `assetSchedules.status.${status}`,
      )}
      tone={tone}
    />
  );
}

/**
 * Stored schedule of a fixed asset (depreciation) or prepaid expense
 * (recognition): one row per monthly period with its status, the journal
 * entry the Posting Engine created for it and the last posting error.
 * Rows stack as cards on phones (no sideways scrolling).
 */
export function AccountingScheduleTable({
  rows,
  currency,
}: {
  rows: ScheduleRow[];
  currency?: string | null;
}) {
  const { t } = useLocale();
  const columns: CompactDetailColumn<ScheduleRow & { index: number }>[] = [
    {
      id: "period",
      header: t("assetSchedules.columns.period"),
      cell: (row) => (
        <span className="num" dir="ltr">
          {row.index}
        </span>
      ),
    },
    {
      id: "start",
      header: t("assetSchedules.columns.start"),
      cell: (row) => formatDate(row.periodStart),
    },
    {
      id: "end",
      header: t("assetSchedules.columns.end"),
      cell: (row) => formatDate(row.periodEnd),
    },
    {
      id: "amount",
      header: t("assetSchedules.columns.amount"),
      align: "end",
      cell: (row) => <MoneyValue value={row.amount} currency={currency} />,
    },
    {
      id: "status",
      header: t("assetSchedules.columns.status"),
      cell: (row) => <ScheduleStatusBadge status={row.status} failed={Boolean(row.lastError)} />,
    },
    {
      id: "journal",
      header: t("assetSchedules.columns.journal"),
      cell: (row) =>
        row.journalEntry ? (
          <RelatedRecordLink
            kind="JOURNAL_ENTRY"
            id={row.journalEntry.id}
            number={row.journalEntry.entryNumber}
            variant="inline"
          />
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      id: "lastError",
      header: t("assetSchedules.columns.lastError"),
      cell: (row) =>
        row.status === "PENDING" && row.lastError ? (
          <span className="text-caption text-warning-foreground [overflow-wrap:anywhere]">
            {row.lastError}
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
  ];
  return (
    <CompactDetailTable
      columns={columns}
      rows={rows.map((row, index) => ({ ...row, index: index + 1 }))}
      rowKey={(row) => row.id}
      empty={t("common.noResults")}
      stacked
    />
  );
}

/** A computed schedule (before capitalization / activation) with running totals. */
export function SchedulePreviewTable({
  rows,
  remainingLabel,
  currency,
}: {
  rows: SchedulePreviewRow[];
  /** "Book value" for an asset, "Remaining" for a prepayment. */
  remainingLabel: string;
  currency?: string | null;
}) {
  const { t } = useLocale();
  const columns: CompactDetailColumn<SchedulePreviewRow>[] = [
    {
      id: "period",
      header: t("assetSchedules.columns.period"),
      cell: (row) => (
        <span className="num" dir="ltr">
          {row.index}
        </span>
      ),
    },
    {
      id: "end",
      header: t("assetSchedules.columns.end"),
      cell: (row) => formatDate(row.periodEnd),
    },
    {
      id: "amount",
      header: t("assetSchedules.columns.amount"),
      align: "end",
      cell: (row) => <MoneyValue value={row.amount} currency={currency} />,
    },
    {
      id: "cumulative",
      header: t("assetSchedules.columns.cumulative"),
      align: "end",
      cell: (row) => <MoneyValue value={row.cumulative} currency={currency} />,
    },
    {
      id: "remaining",
      header: remainingLabel,
      align: "end",
      cell: (row) => <MoneyValue value={row.remaining} currency={currency} />,
    },
  ];
  return (
    <CompactDetailTable
      columns={columns}
      rows={rows}
      rowKey={(row) => String(row.index)}
      empty={t("common.noResults")}
      stacked
    />
  );
}
