"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { Ban, Copy, Eye, Pencil, Printer, Archive } from "lucide-react";
import { StatusBadge } from "@/components/business/status-badge";
import { formatDate } from "@/lib/date";
import { useLocale } from "@/providers/locale-provider";
import type { SalesReturnRow } from "@/services/sales-returns-service";
import { SalesDocumentRowActionsMenu, type SalesDocumentRowAction } from "@/components/sales";
import {
  RETURN_ARCHIVABLE_STATUSES,
  RETURN_CANCELLABLE_STATUSES,
  RETURN_STATUS_LABEL_KEY,
  RETURN_STATUS_TONE,
} from "./return-status";

function StatusCell({ status }: { status: SalesReturnRow["status"] }) {
  const { t } = useLocale();
  return (
    <StatusBadge label={t(RETURN_STATUS_LABEL_KEY[status])} tone={RETURN_STATUS_TONE[status]} />
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

export interface ReturnRowHandlers {
  usersById: Record<string, string>;
  onView: (row: SalesReturnRow) => void;
  onDuplicate: (row: SalesReturnRow) => void;
  onPrint: (row: SalesReturnRow) => void;
  onCancel: (row: SalesReturnRow) => void;
  onArchive: (row: SalesReturnRow) => void;
}

function ActionsCell({ row, handlers }: { row: SalesReturnRow; handlers: ReturnRowHandlers }) {
  const { t } = useLocale();
  const isDraft = row.status === "DRAFT";
  const actions: SalesDocumentRowAction[] = [
    {
      key: "view",
      label: t("sales.returns.open"),
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
      label: t("sales.returns.actions.cancel"),
      icon: Ban,
      hidden: !RETURN_CANCELLABLE_STATUSES.includes(row.status),
      destructive: true,
      separatorBefore: true,
      onSelect: () => handlers.onCancel(row),
    },
    {
      key: "archive",
      label: t("common.archive"),
      icon: Archive,
      hidden: !RETURN_ARCHIVABLE_STATUSES.includes(row.status),
      destructive: true,
      onSelect: () => handlers.onArchive(row),
    },
  ];
  return <SalesDocumentRowActionsMenu actions={actions} label={t("common.actions")} />;
}

export function buildReturnColumns(
  handlers: ReturnRowHandlers,
): ColumnDef<SalesReturnRow, unknown>[] {
  return [
    {
      id: "returnNumber",
      meta: { titleKey: "sales.returns.fields.number" },
      accessorFn: (row) => row.returnNumber,
      cell: (info) => (
        <code dir="ltr" className="rounded bg-muted px-1.5 py-0.5 text-xs">
          {info.getValue() as string}
        </code>
      ),
    },
    {
      id: "customer",
      meta: { titleKey: "sales.returns.fields.customer" },
      accessorFn: (row) => row.customer?.name ?? "—",
      cell: (info) => <span className="font-medium">{info.getValue() as string}</span>,
    },
    {
      id: "referenceNumber",
      meta: { titleKey: "sales.returns.fields.reference" },
      accessorFn: (row) => row.referenceNumber ?? "—",
      enableSorting: false,
    },
    {
      id: "grandTotal",
      meta: { titleKey: "sales.returns.fields.grandTotal" },
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
      meta: { titleKey: "sales.returns.fields.date" },
      accessorFn: (row) => formatDate(row.createdAt),
    },
    {
      id: "createdBy",
      meta: { titleKey: "sales.returns.fields.createdBy" },
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

export const returnExportColumns = [
  "returnNumber",
  "customer",
  "referenceNumber",
  "grandTotal",
  "status",
  "createdAt",
  "createdBy",
];
