"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { Ban, Copy, Eye, Pencil, Printer, Archive } from "lucide-react";
import { StatusBadge } from "@/components/business/status-badge";
import { formatDate } from "@/lib/date";
import { useLocale } from "@/providers/locale-provider";
import type { SalesQuotationRow } from "@/services/sales-quotations-service";
import { SalesDocumentRowActionsMenu, type SalesDocumentRowAction } from "@/components/sales";
import {
  QUOTATION_ARCHIVABLE_STATUSES,
  QUOTATION_CANCELLABLE_STATUSES,
  QUOTATION_STATUS_LABEL_KEY,
  QUOTATION_STATUS_TONE,
} from "./quotation-status";

function StatusCell({ status }: { status: SalesQuotationRow["status"] }) {
  const { t } = useLocale();
  return (
    <StatusBadge
      label={t(QUOTATION_STATUS_LABEL_KEY[status])}
      tone={QUOTATION_STATUS_TONE[status]}
    />
  );
}

function MoneyCell({ value }: { value: string }) {
  return (
    <span dir="ltr">
      {Number(value).toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}
    </span>
  );
}

export interface QuotationRowHandlers {
  /** Maps a `createdBy` user id to a display name — empty map renders the id's absence as "—". */
  usersById: Record<string, string>;
  onView: (row: SalesQuotationRow) => void;
  onDuplicate: (row: SalesQuotationRow) => void;
  onPrint: (row: SalesQuotationRow) => void;
  onCancel: (row: SalesQuotationRow) => void;
  onArchive: (row: SalesQuotationRow) => void;
}

function ActionsCell({
  row,
  handlers,
}: {
  row: SalesQuotationRow;
  handlers: QuotationRowHandlers;
}) {
  const { t } = useLocale();
  const isDraft = row.status === "DRAFT";
  const actions: SalesDocumentRowAction[] = [
    {
      key: "view",
      label: t("sales.quotations.open"),
      icon: Eye,
      onSelect: () => handlers.onView(row),
    },
    {
      key: "edit",
      label: t("common.edit"),
      icon: Pencil,
      hidden: !isDraft,
      onSelect: () => handlers.onView(row),
    },
    {
      key: "duplicate",
      label: t("table.duplicate"),
      icon: Copy,
      onSelect: () => handlers.onDuplicate(row),
    },
    { key: "print", label: t("table.print"), icon: Printer, onSelect: () => handlers.onPrint(row) },
    {
      key: "cancel",
      label: t("sales.quotations.actions.cancel"),
      icon: Ban,
      hidden: !QUOTATION_CANCELLABLE_STATUSES.includes(row.status),
      destructive: true,
      separatorBefore: true,
      onSelect: () => handlers.onCancel(row),
    },
    {
      key: "archive",
      label: t("common.archive"),
      icon: Archive,
      hidden: !QUOTATION_ARCHIVABLE_STATUSES.includes(row.status),
      destructive: true,
      onSelect: () => handlers.onArchive(row),
    },
  ];
  return <SalesDocumentRowActionsMenu actions={actions} label={t("common.actions")} />;
}

/** Factory, not a static array — the Actions cell needs the page's own handlers to act on a row. */
export function buildQuotationColumns(
  handlers: QuotationRowHandlers,
): ColumnDef<SalesQuotationRow, unknown>[] {
  return [
    {
      id: "quotationNumber",
      meta: { titleKey: "sales.quotations.fields.number" },
      accessorFn: (row) => row.quotationNumber,
      cell: (info) => (
        <code dir="ltr" className="rounded bg-muted px-1.5 py-0.5 text-xs">
          {info.getValue() as string}
        </code>
      ),
    },
    {
      id: "customer",
      meta: { titleKey: "sales.quotations.fields.customer" },
      accessorFn: (row) => row.customer?.name ?? "—",
      cell: (info) => <span className="font-medium">{info.getValue() as string}</span>,
    },
    {
      id: "referenceNumber",
      meta: { titleKey: "sales.quotations.fields.reference" },
      accessorFn: (row) => row.referenceNumber ?? "—",
      enableSorting: false,
    },
    {
      id: "grandTotal",
      meta: { titleKey: "sales.quotations.fields.grandTotal" },
      accessorFn: (row) => row.grandTotal,
      cell: (info) => <MoneyCell value={info.getValue() as string} />,
    },
    {
      id: "status",
      meta: { titleKey: "sales.customers.fields.status" },
      enableSorting: false,
      cell: ({ row }) => <StatusCell status={row.original.status} />,
    },
    {
      id: "createdAt",
      meta: { titleKey: "sales.quotations.fields.date" },
      accessorFn: (row) => formatDate(row.createdAt),
    },
    {
      id: "createdBy",
      meta: { titleKey: "sales.quotations.fields.createdBy" },
      enableSorting: false,
      accessorFn: (row) => (row.createdBy ? (handlers.usersById[row.createdBy] ?? "—") : "—"),
    },
    {
      id: "__actions",
      meta: { titleKey: "common.actions" },
      enableHiding: false,
      enableSorting: false,
      cell: ({ row }) => <ActionsCell row={row.original} handlers={handlers} />,
    },
  ];
}

export const quotationExportColumns = [
  "quotationNumber",
  "customer",
  "referenceNumber",
  "grandTotal",
  "status",
  "createdAt",
  "createdBy",
];
