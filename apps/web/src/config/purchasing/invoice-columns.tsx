"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { Ban, Copy, Eye, Pencil, Printer, Archive, Undo2 } from "lucide-react";
import { StatusBadge } from "@/components/business/status-badge";
import { MoneyValue } from "@/components/shared/money-value";
import { SemanticValue } from "@/components/shared/semantic-value";
import { StackedCell } from "@/components/shared/stacked-cell";
import { formatDate } from "@/lib/date";
import { useLocale } from "@/providers/locale-provider";
import { useUserContext } from "@/providers/user-context";
import { documentRowAccess } from "@/components/shared/data-table";
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
  const { hasPermission } = useUserContext();
  const access = documentRowAccess(hasPermission, "purchasing.invoices");
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
      key: "createReturn",
      label: t("purchasing.invoices.actions.createReturn"),
      icon: Undo2,
      hidden: row.status !== "CONFIRMED" || !hasPermission("purchasing.returns.create"),
      onSelect: () => handlers.onCreateReturn(row),
    },
    {
      key: "cancel",
      label: t("purchasing.invoices.actions.cancel"),
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
): ColumnDef<PurchaseInvoiceRow, unknown>[] {
  return [
    {
      id: "invoiceNumber",
      meta: { titleKey: "purchasing.invoices.fields.number", stacked: true, type: "code" },
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
      id: "supplier",
      meta: { titleKey: "purchasing.invoices.fields.supplier" },
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
      meta: { titleKey: "purchasing.invoices.fields.reference", defaultHidden: true },
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
      meta: { titleKey: "purchasing.invoices.fields.grandTotal", defaultHidden: true },
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
      meta: { titleKey: "purchasing.invoices.fields.date" },
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
      meta: { titleKey: "purchasing.invoices.fields.createdBy", defaultHidden: true },
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
