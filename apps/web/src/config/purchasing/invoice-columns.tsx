"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { Ban, Copy, Eye, Pencil, Printer, Archive, Undo2 } from "lucide-react";
import { StatusBadge } from "@/components/business/status-badge";
import { formatDate } from "@/lib/date";
import { useLocale } from "@/providers/locale-provider";
import type { PurchaseInvoiceRow } from "@/services/purchase-invoices-service";
import { SalesDocumentRowActionsMenu, type SalesDocumentRowAction } from "@/components/sales";
import { InvoicePaymentBadge } from "@/components/business/invoice-payment-summary";
import {
  INVOICE_ARCHIVABLE_STATUSES,
  INVOICE_CANCELLABLE_STATUSES,
  INVOICE_STATUS_LABEL_KEY,
  INVOICE_STATUS_TONE,
} from "./invoice-status";

function StatusCell({ status }: { status: PurchaseInvoiceRow["status"] }) {
  const { t } = useLocale();
  return (
    <StatusBadge label={t(INVOICE_STATUS_LABEL_KEY[status])} tone={INVOICE_STATUS_TONE[status]} />
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

export interface InvoiceRowHandlers {
  usersById: Record<string, string>;
  onView: (row: PurchaseInvoiceRow) => void;
  onDuplicate: (row: PurchaseInvoiceRow) => void;
  onPrint: (row: PurchaseInvoiceRow) => void;
  onCancel: (row: PurchaseInvoiceRow) => void;
  onArchive: (row: PurchaseInvoiceRow) => void;
  onCreateReturn: (row: PurchaseInvoiceRow) => void;
}

function ActionsCell({ row, handlers }: { row: PurchaseInvoiceRow; handlers: InvoiceRowHandlers }) {
  const { t } = useLocale();
  const isDraft = row.status === "DRAFT";
  const actions: SalesDocumentRowAction[] = [
    {
      key: "view",
      label: t("purchasing.invoices.open"),
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
      key: "createReturn",
      label: t("purchasing.invoices.actions.createReturn"),
      icon: Undo2,
      hidden: row.status !== "CONFIRMED",
      onSelect: () => handlers.onCreateReturn(row),
    },
    {
      key: "cancel",
      label: t("purchasing.invoices.actions.cancel"),
      icon: Ban,
      hidden: !INVOICE_CANCELLABLE_STATUSES.includes(row.status),
      destructive: true,
      separatorBefore: true,
      onSelect: () => handlers.onCancel(row),
    },
    {
      key: "archive",
      label: t("common.archive"),
      icon: Archive,
      hidden: !INVOICE_ARCHIVABLE_STATUSES.includes(row.status),
      destructive: true,
      onSelect: () => handlers.onArchive(row),
    },
  ];
  return <SalesDocumentRowActionsMenu actions={actions} label={t("common.actions")} />;
}

export function buildInvoiceColumns(
  handlers: InvoiceRowHandlers,
): ColumnDef<PurchaseInvoiceRow, unknown>[] {
  return [
    {
      id: "invoiceNumber",
      meta: { titleKey: "purchasing.invoices.fields.number" },
      accessorFn: (row) => row.invoiceNumber,
      cell: (info) => (
        <code dir="ltr" className="rounded bg-muted px-1.5 py-0.5 text-xs">
          {info.getValue() as string}
        </code>
      ),
    },
    {
      id: "supplier",
      meta: { titleKey: "purchasing.invoices.fields.supplier" },
      accessorFn: (row) => row.supplier?.name ?? "—",
      cell: (info) => <span className="font-medium">{info.getValue() as string}</span>,
    },
    {
      id: "referenceNumber",
      meta: { titleKey: "purchasing.invoices.fields.reference" },
      accessorFn: (row) => row.referenceNumber ?? "—",
      enableSorting: false,
    },
    {
      id: "grandTotal",
      meta: { titleKey: "purchasing.invoices.fields.grandTotal" },
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
      id: "paymentStatus",
      meta: { titleKey: "financialTransactions.paymentSummary.title" },
      enableSorting: false,
      cell: ({ row }) => <InvoicePaymentBadge paymentStatus={row.original.paymentStatus} />,
    },
    {
      id: "createdAt",
      meta: { titleKey: "purchasing.invoices.fields.date" },
      accessorFn: (row) => formatDate(row.createdAt),
    },
    {
      id: "createdBy",
      meta: { titleKey: "purchasing.invoices.fields.createdBy" },
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

export const invoiceExportColumns = [
  "invoiceNumber",
  "supplier",
  "referenceNumber",
  "grandTotal",
  "status",
  "paymentStatus",
  "createdAt",
  "createdBy",
];
