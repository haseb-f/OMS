"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { Ban, Copy, Eye, Pencil, Printer, Archive } from "lucide-react";
import { StatusBadge } from "@/components/business/status-badge";
import { SemanticValue } from "@/components/shared/semantic-value";
import { StackedCell } from "@/components/shared/stacked-cell";
import { formatDate } from "@/lib/date";
import { useLocale } from "@/providers/locale-provider";
import { useUserContext } from "@/providers/user-context";
import { documentRowAccess } from "@/components/shared/data-table";
import type { SalesInvoiceRow } from "@/services/sales-invoices-service";
import { SalesDocumentRowActionsMenu, type SalesDocumentRowAction } from "@/components/sales";
import { invoiceMoneyColumns } from "@/config/financial-transactions/invoice-payment-columns";
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

/** The row's actions control — the Grid card renders this same component, so both views share one permission model. */
export function InvoiceActionsCell({
  row,
  handlers,
}: {
  row: SalesInvoiceRow;
  handlers: InvoiceRowHandlers;
}) {
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
      accessorFn: (row) => row.partner?.name ?? "—",
      cell: ({ row }) => (
        <StackedCell
          primary={row.original.partner?.name ?? "—"}
          secondary={
            row.original.partner?.phone ? (
              <SemanticValue kind="phone">{row.original.partner.phone}</SemanticValue>
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
      // R22 §5 — the document status only (badge, compact); the amounts have their own columns.
      meta: {
        titleKey: "sales.customers.fields.status",
        type: "status",
        minWidth: 96,
        maxWidth: 136,
      },
      enableSorting: false,
      cell: ({ row }) => <StatusCell status={row.original.status} />,
    },
    ...invoiceMoneyColumns<SalesInvoiceRow>("sales.invoices.fields.grandTotal"),
    {
      id: "createdAt",
      meta: { titleKey: "sales.invoices.fields.date", type: "date" },
      accessorFn: (row) => formatDate(row.createdAt),
      cell: ({ row }) => (
        <StackedCell
          primary={<span className="num">{formatDate(row.original.createdAt)}</span>}
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
      cell: ({ row }) => <InvoiceActionsCell row={row.original} handlers={handlers} />,
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
  "allocatedTotal",
  "remainingBalance",
  "createdAt",
  "createdBy",
];
