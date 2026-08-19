"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { Ban, Copy, Eye, Pencil, Printer, Archive } from "lucide-react";
import { StatusBadge } from "@/components/business/status-badge";
import { MoneyValue } from "@/components/shared/money-value";
import { SemanticValue } from "@/components/shared/semantic-value";
import { StackedCell } from "@/components/shared/stacked-cell";
import { formatDate } from "@/lib/date";
import { useLocale } from "@/providers/locale-provider";
import { useUserContext } from "@/providers/user-context";
import { documentRowAccess } from "@/components/shared/data-table";
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
  const { hasPermission } = useUserContext();
  const access = documentRowAccess(hasPermission, "sales.invoices");
  const isDraft = row.status === "DRAFT";
  const actions: SalesDocumentRowAction[] = [
    {
      key: "view",
      label: t("common.view"),
      icon: Eye,
      hidden: !access.canView,
      onSelect: () => handlers.onView(row),
    },
    {
      key: "edit",
      label: t("common.edit"),
      icon: Pencil,
      hidden: !isDraft || !access.canEdit,
      onSelect: () => handlers.onView(row),
    },
    {
      key: "duplicate",
      label: t("table.duplicate"),
      icon: Copy,
      hidden: !access.canCreate,
      onSelect: () => handlers.onDuplicate(row),
    },
    {
      key: "print",
      label: t("table.print"),
      icon: Printer,
      hidden: !access.canPrint,
      onSelect: () => handlers.onPrint(row),
    },
    {
      key: "cancel",
      label: t("sales.invoices.actions.cancel"),
      icon: Ban,
      hidden: !INVOICE_CANCELLABLE_STATUSES.includes(row.status) || !access.canCancel,
      destructive: true,
      separatorBefore: true,
      onSelect: () => handlers.onCancel(row),
    },
    {
      key: "archive",
      label: t("common.archive"),
      icon: Archive,
      hidden: !INVOICE_ARCHIVABLE_STATUSES.includes(row.status) || !access.canArchive,
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
      meta: {
        titleKey: "sales.invoices.fields.number",
        stacked: true,
        type: "code",
        identity: true,
      },
      accessorFn: (row) => row.invoiceNumber,
      cell: ({ row }) => (
        <StackedCell
          primary={
            <SemanticValue kind="id" className="text-body font-medium">
              {row.original.invoiceNumber}
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
      id: "customer",
      meta: { titleKey: "sales.invoices.fields.customer", stacked: true, type: "name" },
      accessorFn: (row) => row.customer?.name ?? "—",
      cell: ({ row }) => (
        <StackedCell
          primary={row.original.customer?.name ?? "—"}
          secondary={
            row.original.customer?.phone ? (
              <SemanticValue kind="phone">{row.original.customer.phone}</SemanticValue>
            ) : undefined
          }
        />
      ),
    },
    {
      id: "referenceNumber",
      meta: { titleKey: "sales.invoices.fields.reference", defaultHidden: true },
      accessorFn: (row) => row.referenceNumber ?? "—",
      enableSorting: false,
    },
    {
      id: "status",
      meta: { titleKey: "sales.customers.fields.status" },
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
      meta: { titleKey: "sales.invoices.fields.grandTotal", defaultHidden: true },
      accessorFn: (row) => row.grandTotal,
      cell: ({ row }) => <MoneyValue value={row.original.grandTotal} />,
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
      meta: { titleKey: "sales.invoices.fields.createdBy", defaultHidden: true },
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
