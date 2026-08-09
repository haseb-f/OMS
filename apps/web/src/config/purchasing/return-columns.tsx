"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { Ban, Eye, Pencil, Printer, Archive } from "lucide-react";
import { StatusBadge } from "@/components/business/status-badge";
import { formatDate } from "@/lib/date";
import { useLocale } from "@/providers/locale-provider";
import type { PurchaseReturnRow } from "@/services/purchase-returns-service";
import { SalesDocumentRowActionsMenu, type SalesDocumentRowAction } from "@/components/sales";
import {
  RETURN_ARCHIVABLE_STATUSES,
  RETURN_CANCELLABLE_STATUSES,
  RETURN_STATUS_LABEL_KEY,
  RETURN_STATUS_TONE,
} from "./return-status";

function StatusCell({ status }: { status: PurchaseReturnRow["status"] }) {
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
  onView: (row: PurchaseReturnRow) => void;
  onPrint: (row: PurchaseReturnRow) => void;
  onCancel: (row: PurchaseReturnRow) => void;
  onArchive: (row: PurchaseReturnRow) => void;
}

function ActionsCell({ row, handlers }: { row: PurchaseReturnRow; handlers: ReturnRowHandlers }) {
  const { t } = useLocale();
  const isDraft = row.status === "DRAFT";
  const actions: SalesDocumentRowAction[] = [
    {
      key: "view",
      label: t("purchasing.returns.open"),
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
    { key: "print", label: t("table.print"), icon: Printer, onSelect: () => handlers.onPrint(row) },
    {
      key: "cancel",
      label: t("purchasing.returns.actions.cancel"),
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
): ColumnDef<PurchaseReturnRow, unknown>[] {
  return [
    {
      id: "returnNumber",
      meta: { titleKey: "purchasing.returns.fields.number" },
      accessorFn: (row) => row.returnNumber,
      cell: (info) => (
        <code dir="ltr" className="rounded bg-muted px-1.5 py-0.5 text-xs">
          {info.getValue() as string}
        </code>
      ),
    },
    {
      id: "supplier",
      meta: { titleKey: "purchasing.returns.fields.supplier" },
      accessorFn: (row) => row.supplier?.name ?? "—",
      cell: (info) => <span className="font-medium">{info.getValue() as string}</span>,
    },
    {
      id: "referenceNumber",
      meta: { titleKey: "purchasing.returns.fields.reference" },
      accessorFn: (row) => row.referenceNumber ?? "—",
      enableSorting: false,
    },
    {
      id: "grandTotal",
      meta: { titleKey: "purchasing.returns.fields.grandTotal" },
      accessorFn: (row) => row.grandTotal,
      cell: (info) => <MoneyCell value={info.getValue() as string} />,
    },
    {
      id: "status",
      meta: { titleKey: "purchasing.suppliers.fields.status" },
      enableSorting: false,
      cell: ({ row }) => <StatusCell status={row.original.status} />,
    },
    {
      id: "createdAt",
      meta: { titleKey: "purchasing.returns.fields.date" },
      accessorFn: (row) => formatDate(row.createdAt),
    },
    {
      id: "createdBy",
      meta: { titleKey: "purchasing.returns.fields.createdBy" },
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
  "supplier",
  "referenceNumber",
  "grandTotal",
  "status",
  "createdAt",
  "createdBy",
];
