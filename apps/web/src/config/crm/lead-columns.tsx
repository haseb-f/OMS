"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { StatusBadge } from "@/components/business/status-badge";
import { LocaleText } from "@/components/shared/locale-text";
import { SemanticValue } from "@/components/shared/semantic-value";
import { StackedCell } from "@/components/shared/stacked-cell";
import { formatDisplayDate } from "@/lib/date";
import { useLocale } from "@/providers/locale-provider";
import { leadStatusBadge } from "@/components/crm/lead-status-label";
import type { LeadRow } from "@/services/leads-service";
import type { MessageKey } from "@/i18n/translate";
import { followUpOutcomeLabel } from "@/config/crm/follow-up-outcomes";
import { FollowUpOutcomeBadge } from "@/components/crm/follow-up-outcome-badge";

/**
 * Initial ownership lifecycle (blue "New" vs. orange "Assigned") layered
 * purely on top of the existing NEW status + `salesEmployeeId` — never a
 * second status field. `salesEmployeeId` already flows through ONE
 * canonical path (manual assign, bulk-assign, and Auto Distribution all
 * call the same `LeadAssignmentsService.assign()`), so this derivation is
 * automatically correct for every assignment source, including
 * reassignment (still non-null, still "Assigned", never reverts to blue).
 * Every later workflow status (IN_PROGRESS, QUALIFIED, CONVERTED, ...)
 * renders unchanged via the dynamic Master Data color — this only
 * overrides the single NEW case.
 */
export function leadLifecycleBadge(
  lead: Pick<LeadRow, "status" | "salesEmployeeId">,
  assignedLabel: string,
) {
  if (lead.status?.code === "NEW") {
    return lead.salesEmployeeId
      ? { label: assignedLabel, colorKey: "warning" }
      : { label: lead.status.name, colorKey: "info" };
  }
  return { label: lead.status?.name ?? "—", colorKey: lead.status?.color };
}

export function LeadStatusCell({ lead }: { lead: Pick<LeadRow, "status" | "salesEmployeeId"> }) {
  const badge = leadStatusBadge(lead, useLocale());
  return <StatusBadge label={badge.label} colorKey={badge.colorKey} />;
}

/** The lead source in the UI language, never the raw code. */
function LeadSourceCell({ source }: { source: string }) {
  const { t } = useLocale();
  return <>{t(`crm.leads.source.${source}` as MessageKey)}</>;
}

function NextFollowUpCell({ value }: { value: string | null }) {
  const { t } = useLocale();
  if (!value) return <span>—</span>;
  const when = new Date(value);
  const now = new Date();
  const startToday = new Date(now);
  startToday.setHours(0, 0, 0, 0);
  const startTomorrow = new Date(startToday);
  startTomorrow.setDate(startTomorrow.getDate() + 1);
  const startDayAfter = new Date(startTomorrow);
  startDayAfter.setDate(startDayAfter.getDate() + 1);
  const overdue = when.getTime() < now.getTime();

  if (when >= startToday && when < startTomorrow) {
    return <span>{t("crm.leads.followUp.today")}</span>;
  }
  if (when >= startTomorrow && when < startDayAfter) {
    return <span>{t("crm.leads.followUp.tomorrow")}</span>;
  }
  if (overdue) {
    return <span className="text-destructive font-medium">{t("crm.leads.followUp.overdue")}</span>;
  }
  return <SemanticValue kind="date">{formatDisplayDate(value)}</SemanticValue>;
}

export const leadColumns: ColumnDef<LeadRow, unknown>[] = [
  {
    id: "leadNumber",
    meta: { titleKey: "crm.leads.fields.leadNumber", identity: true, type: "code" },
    accessorFn: (row) => row.leadNumber,
    cell: ({ row }) => (
      <span title={row.original.leadNumber} className="inline-flex min-w-0 max-w-full">
        <SemanticValue kind="id" className="text-body font-medium">
          {row.original.leadNumber}
        </SemanticValue>
      </span>
    ),
  },
  {
    id: "customerName",
    meta: { titleKey: "crm.leads.fields.customerName", type: "name" },
    accessorFn: (row) => row.customerName,
    cell: ({ row }) => (
      <StackedCell
        primary={<LocaleText>{row.original.customerName}</LocaleText>}
        secondary={
          row.original.mobileNumber ? (
            <SemanticValue kind="phone">{row.original.mobileNumber}</SemanticValue>
          ) : undefined
        }
      />
    ),
  },
  {
    id: "mobileNumber",
    meta: { titleKey: "crm.leads.fields.mobileNumber", defaultHidden: true, type: "phone" },
    accessorFn: (row) => row.mobileNumber,
    cell: (info) => (
      <span title={String(info.getValue() ?? "")} className="inline-flex min-w-0 max-w-full">
        <SemanticValue kind="phone">{info.getValue() as string}</SemanticValue>
      </span>
    ),
  },
  {
    id: "country",
    meta: { titleKey: "crm.leads.fields.country", type: "name", importance: "low" },
    accessorFn: (row) => row.country?.name ?? "—",
  },
  {
    id: "status",
    meta: { titleKey: "common.status", type: "status" },
    enableSorting: false,
    cell: ({ row }) => <LeadStatusCell lead={row.original} />,
  },
  {
    id: "followUpOutcome",
    meta: {
      titleKey: "leadOps.outcome.label",
      type: "status",
      importance: "medium",
      displayValue: (row, t) => followUpOutcomeLabel(row.followUpOutcome, t),
    },
    enableSorting: false,
    accessorFn: (row) => row.followUpOutcome ?? "",
    cell: ({ row }) => <FollowUpOutcomeBadge value={row.original.followUpOutcome} />,
  },
  {
    id: "source",
    meta: {
      titleKey: "crm.leads.fields.source",
      type: "name",
      importance: "low",
      displayValue: (row, t) => t(`crm.leads.source.${row.source}` as MessageKey),
    },
    accessorFn: (row) => row.source,
    cell: ({ row }) => <LeadSourceCell source={row.original.source} />,
  },
  {
    id: "salesEmployee",
    meta: { titleKey: "crm.leads.fields.assignedTo", type: "name", importance: "medium" },
    enableSorting: false,
    accessorFn: (row) => row.salesEmployee?.fullName ?? "—",
  },
  {
    id: "nextFollowUpAt",
    meta: { titleKey: "crm.leads.fields.nextFollowUp", type: "date" },
    cell: ({ row }) => <NextFollowUpCell value={row.original.nextFollowUpAt} />,
  },
  {
    id: "createdAt",
    meta: { titleKey: "crm.leads.fields.createdAt", type: "date" },
    accessorFn: (row) => formatDisplayDate(row.createdAt),
  },
];

export const leadExportColumns = [
  "leadNumber",
  "customerName",
  "mobileNumber",
  "quantity",
  "status",
  "followUpOutcome",
  "salesEmployee",
  "nextFollowUpAt",
  "createdAt",
];

export const leadRowLabel = (row: LeadRow) => `${row.leadNumber} — ${row.customerName}`;

/**
 * Smart Selection "Export Selected" (bulk action bar) — flattens exactly
 * the operational fields a caller is meant to see (never internal/hidden
 * columns) into the same keys `leadExportColumns` already names, so this
 * plugs straight into `exportRowsToCsv`. Mirrors `storeOrderPrintRow`'s
 * shape/spirit for Store Orders.
 */
export function leadExportRow(
  row: LeadRow,
  t: (key: MessageKey) => string,
): Record<string, string> {
  return {
    leadNumber: row.leadNumber,
    customerName: row.customerName,
    mobileNumber: row.mobileNumber,
    country: row.country?.name ?? "",
    source: row.source,
    quantity: String(row.quantity),
    status: row.status?.name ?? "",
    followUpOutcome: followUpOutcomeLabel(row.followUpOutcome, t),
    salesEmployee: row.salesEmployee?.fullName ?? "",
    nextFollowUpAt: row.nextFollowUpAt ? formatDisplayDate(row.nextFollowUpAt) : "",
    createdAt: formatDisplayDate(row.createdAt),
  };
}

export const leadExportSelectedColumns = [
  "leadNumber",
  "customerName",
  "mobileNumber",
  "country",
  "source",
  "quantity",
  "status",
  "followUpOutcome",
  "salesEmployee",
  "nextFollowUpAt",
  "createdAt",
];
