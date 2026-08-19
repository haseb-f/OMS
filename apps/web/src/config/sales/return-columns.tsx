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
  const { hasPermission } = useUserContext();
  const access = documentRowAccess(hasPermission, "sales.returns");
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
      label: t("sales.returns.actions.cancel"),
      icon: Ban,
      hidden: !RETURN_CANCELLABLE_STATUSES.includes(row.status) || !access.canCancel,
      destructive: true,
      separatorBefore: true,
      onSelect: () => handlers.onCancel(row),
    },
    {
      key: "archive",
      label: t("common.archive"),
      icon: Archive,
      hidden: !RETURN_ARCHIVABLE_STATUSES.includes(row.status) || !access.canArchive,
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
      meta: { titleKey: "sales.returns.fields.number", stacked: true, type: "code" },
      accessorFn: (row) => row.returnNumber,
      cell: ({ row }) => (
        <StackedCell
          primary={
            <SemanticValue kind="id" className="text-body font-medium">
              {row.original.returnNumber}
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
      meta: { titleKey: "sales.returns.fields.customer" },
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
      meta: { titleKey: "sales.returns.fields.reference", defaultHidden: true },
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
      meta: { titleKey: "sales.returns.fields.grandTotal", defaultHidden: true },
      accessorFn: (row) => row.grandTotal,
      cell: ({ row }) => <MoneyValue value={row.original.grandTotal} />,
    },
    {
      id: "createdAt",
      meta: { titleKey: "sales.returns.fields.date" },
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
      meta: { titleKey: "sales.returns.fields.createdBy", defaultHidden: true },
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
