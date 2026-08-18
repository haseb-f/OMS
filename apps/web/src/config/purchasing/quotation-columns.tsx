"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { Ban, Copy, Eye, Pencil, Printer, Archive } from "lucide-react";
import { StatusBadge } from "@/components/business/status-badge";
import { MoneyValue } from "@/components/shared/money-value";
import { SemanticValue } from "@/components/shared/semantic-value";
import { StackedCell } from "@/components/shared/stacked-cell";
import { formatDate } from "@/lib/date";
import { useLocale } from "@/providers/locale-provider";
import type { PurchaseQuotationRow } from "@/services/purchase-quotations-service";
import { SalesDocumentRowActionsMenu, type SalesDocumentRowAction } from "@/components/sales";
import {
  QUOTATION_ARCHIVABLE_STATUSES,
  QUOTATION_CANCELLABLE_STATUSES,
  QUOTATION_STATUS_LABEL_KEY,
  QUOTATION_STATUS_TONE,
} from "./quotation-status";

function StatusCell({ status }: { status: PurchaseQuotationRow["status"] }) {
  const { t } = useLocale();
  return (
    <StatusBadge
      label={t(QUOTATION_STATUS_LABEL_KEY[status])}
      tone={QUOTATION_STATUS_TONE[status]}
    />
  );
}

export interface QuotationRowHandlers {
  usersById: Record<string, string>;
  onView: (row: PurchaseQuotationRow) => void;
  onDuplicate: (row: PurchaseQuotationRow) => void;
  onPrint: (row: PurchaseQuotationRow) => void;
  onCancel: (row: PurchaseQuotationRow) => void;
  onArchive: (row: PurchaseQuotationRow) => void;
}

function ActionsCell({
  row,
  handlers,
}: {
  row: PurchaseQuotationRow;
  handlers: QuotationRowHandlers;
}) {
  const { t } = useLocale();
  const isDraft = row.status === "DRAFT";
  const actions: SalesDocumentRowAction[] = [
    {
      key: "view",
      label: t("purchasing.quotations.open"),
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
      label: t("purchasing.quotations.actions.cancel"),
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

export function buildQuotationColumns(
  handlers: QuotationRowHandlers,
): ColumnDef<PurchaseQuotationRow, unknown>[] {
  return [
    {
      id: "quotationNumber",
      meta: { titleKey: "purchasing.quotations.fields.number", stacked: true, type: "code" },
      accessorFn: (row) => row.quotationNumber,
      cell: ({ row }) => (
        <StackedCell
          primary={
            <SemanticValue kind="id" className="text-body font-medium">
              {row.original.quotationNumber}
            </SemanticValue>
          }
          secondary={
            row.original.referenceNumber ? (
              <SemanticValue kind="id">{row.original.referenceNumber}</SemanticValue>
            ) : undefined
          }
        />
      ),
    },
    {
      id: "supplier",
      meta: { titleKey: "purchasing.quotations.fields.supplier" },
      accessorFn: (row) => row.supplier?.name ?? "—",
      cell: ({ row }) => (
        <StackedCell
          primary={row.original.supplier?.name ?? "—"}
          secondary={
            row.original.supplier?.phone ? (
              <SemanticValue kind="phone">{row.original.supplier.phone}</SemanticValue>
            ) : undefined
          }
        />
      ),
    },
    {
      id: "referenceNumber",
      meta: { titleKey: "purchasing.quotations.fields.reference", defaultHidden: true },
      accessorFn: (row) => row.referenceNumber ?? "—",
      enableSorting: false,
    },
    {
      id: "status",
      meta: { titleKey: "purchasing.suppliers.fields.status" },
      enableSorting: false,
      cell: ({ row }) => (
        <StackedCell
          primary={<StatusCell status={row.original.status} />}
          secondary={<MoneyValue value={row.original.grandTotal} />}
        />
      ),
    },
    {
      id: "grandTotal",
      meta: { titleKey: "purchasing.quotations.fields.grandTotal", defaultHidden: true },
      accessorFn: (row) => row.grandTotal,
      cell: ({ row }) => <MoneyValue value={row.original.grandTotal} />,
    },
    {
      id: "createdAt",
      meta: { titleKey: "purchasing.quotations.fields.date" },
      accessorFn: (row) => formatDate(row.createdAt),
      cell: ({ row }) => (
        <StackedCell
          primary={formatDate(row.original.createdAt)}
          secondary={
            row.original.createdBy
              ? (handlers.usersById[row.original.createdBy] ?? undefined)
              : undefined
          }
        />
      ),
    },
    {
      id: "createdBy",
      meta: { titleKey: "purchasing.quotations.fields.createdBy", defaultHidden: true },
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
  "supplier",
  "referenceNumber",
  "grandTotal",
  "status",
  "createdAt",
  "createdBy",
];
