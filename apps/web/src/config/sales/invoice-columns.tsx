"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { Ban, Copy, Eye, Pencil, Printer, Archive } from "lucide-react";
import { StatusBadge } from "@/components/business/status-badge";
import { formatDate } from "@/lib/date";
import { useLocale } from "@/providers/locale-provider";
import type { SalesInvoiceRow } from "@/services/sales-invoices-service";
import { SalesDocumentRowActionsMenu, type SalesDocumentRowAction } from "@/components/sales";
import { InvoicePaymentBadge } from "@/components/business/invoice-payment-summary";
import {
  INVOICE_ARCHIVABLE_STATUSES,
  INVOICE_CANCELLABLE_STATUSES,
  INVOICE_STATUS_LABEL_KEY,
  INVOICE_STATUS_TONE,
} from "./invoice-status";

function StatusCell({ status }: { status: SalesInvoiceRow["status"] }) {
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
  onView: (row: SalesInvoiceRow) => void;
  onDuplicate: (row: SalesInvoiceRow) => void;
  onPrint: (row: SalesInvoiceRow) => void;
  onCancel: (row: SalesInvoiceRow) => void;
  onArchive: (row: SalesInvoiceRow) => void;
}

function ActionsCell({ row, handlers }: { row: SalesInvoiceRow; handlers: InvoiceRowHandlers }) {
  const { t } = useLocale();
  const isDraft = row.status === "DRAFT";
  const actions: SalesDocumentRowAction[] = [
    {
      key: "view",
      label: t("sales.invoices.open"),
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
      label: t("sales.invoices.actions.cancel"),
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
): ColumnDef<SalesInvoiceRow, unknown>[] {
  return [
    {
      id: "invoiceNumber",
      meta: { titleKey: "sales.invoices.fields.number" },
      accessorFn: (row) => row.invoiceNumber,
      cell: (info) => (
        <code dir="ltr" className="rounded bg-muted px-1.5 py-0.5 text-xs">
          {info.getValue() as string}
        </code>
      ),
    },
    {
      id: "customer",
      meta: { titleKey: "sales.invoices.fields.customer" },
      accessorFn: (row) => row.customer?.name ?? "—",
      cell: (info) => <span className="font-medium">{info.getValue() as string}</span>,
    },
    {
      id: "referenceNumber",
      meta: { titleKey: "sales.invoices.fields.reference" },
      accessorFn: (row) => row.referenceNumber ?? "—",
      enableSorting: false,
    },
    {
      id: "grandTotal",
      meta: { titleKey: "sales.invoices.fields.grandTotal" },
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
      id: "paymentStatus",
      meta: { titleKey: "financialTransactions.paymentSummary.title" },
      enableSorting: false,
      cell: ({ row }) => <InvoicePaymentBadge paymentStatus={row.original.paymentStatus} />,
    },
    {
      id: "createdAt",
      meta: { titleKey: "sales.invoices.fields.date" },
      accessorFn: (row) => formatDate(row.createdAt),
    },
    {
      id: "createdBy",
      meta: { titleKey: "sales.invoices.fields.createdBy" },
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
  "customer",
  "referenceNumber",
  "grandTotal",
  "status",
  "paymentStatus",
  "createdAt",
  "createdBy",
];
