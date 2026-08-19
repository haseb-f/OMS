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
  const { hasPermission } = useUserContext();
  const access = documentRowAccess(hasPermission, "sales.quotations");
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
      label: t("sales.quotations.actions.cancel"),
      icon: Ban,
      hidden: !QUOTATION_CANCELLABLE_STATUSES.includes(row.status) || !access.canCancel,
      destructive: true,
      separatorBefore: true,
      onSelect: () => handlers.onCancel(row),
    },
    {
      key: "archive",
      label: t("common.archive"),
      icon: Archive,
      hidden: !QUOTATION_ARCHIVABLE_STATUSES.includes(row.status) || !access.canArchive,
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
      meta: {
        titleKey: "sales.quotations.fields.number",
        stacked: true,
        type: "code",
        identity: true,
      },
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
      id: "customer",
      meta: { titleKey: "sales.quotations.fields.customer" },
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
      meta: { titleKey: "sales.quotations.fields.reference", defaultHidden: true },
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
      meta: { titleKey: "sales.quotations.fields.grandTotal", defaultHidden: true },
      accessorFn: (row) => row.grandTotal,
      cell: ({ row }) => <MoneyValue value={row.original.grandTotal} />,
    },
    {
      id: "createdAt",
      meta: { titleKey: "sales.quotations.fields.date" },
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
      meta: { titleKey: "sales.quotations.fields.createdBy", defaultHidden: true },
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
