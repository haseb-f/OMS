"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { Archive, Ban, Copy, Eye, Pencil, Printer } from "lucide-react";
import { StatusBadge } from "@/components/business/status-badge";
import { MoneyValue } from "@/components/shared/money-value";
import { SemanticValue } from "@/components/shared/semantic-value";
import { StackedCell } from "@/components/shared/stacked-cell";
import { formatDate } from "@/lib/date";
import { useLocale } from "@/providers/locale-provider";
import { useUserContext } from "@/providers/user-context";
import { documentRowAccess } from "@/components/shared/data-table";
import type { PurchaseOrderRow } from "@/services/purchase-orders-service";
import { SalesDocumentRowActionsMenu, type SalesDocumentRowAction } from "@/components/sales";
import {
  ORDER_ARCHIVABLE_STATUSES,
  ORDER_CANCELLABLE_STATUSES,
  ORDER_STATUS_LABEL_KEY,
  ORDER_STATUS_TONE,
} from "./order-status";

function StatusCell({ status }: { status: PurchaseOrderRow["status"] }) {
  const { t } = useLocale();
  return <StatusBadge label={t(ORDER_STATUS_LABEL_KEY[status])} tone={ORDER_STATUS_TONE[status]} />;
}

function orderGrandTotal(row: PurchaseOrderRow) {
  return row.items.reduce((sum, item) => sum + Number(item.subtotal), 0);
}

export interface OrderRowHandlers {
  usersById: Record<string, string>;
  onView: (row: PurchaseOrderRow) => void;
  onDuplicate: (row: PurchaseOrderRow) => void;
  onPrint: (row: PurchaseOrderRow) => void;
  onCancel: (row: PurchaseOrderRow) => void;
  onArchive: (row: PurchaseOrderRow) => void;
}

function ActionsCell({ row, handlers }: { row: PurchaseOrderRow; handlers: OrderRowHandlers }) {
  const { t } = useLocale();
  const { hasPermission } = useUserContext();
  const access = documentRowAccess(hasPermission, "purchasing.orders");
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
      label: t("purchasing.orders.actions.cancel"),
      icon: Ban,
      hidden: !ORDER_CANCELLABLE_STATUSES.includes(row.status) || !access.canCancel,
      destructive: true,
      separatorBefore: true,
      onSelect: () => handlers.onCancel(row),
    },
    {
      key: "archive",
      label: t("common.archive"),
      icon: Archive,
      hidden: !ORDER_ARCHIVABLE_STATUSES.includes(row.status) || !access.canArchive,
      destructive: true,
      onSelect: () => handlers.onArchive(row),
    },
  ];
  return <SalesDocumentRowActionsMenu actions={actions} label={t("common.actions")} />;
}

export function buildOrderColumns(
  handlers: OrderRowHandlers,
): ColumnDef<PurchaseOrderRow, unknown>[] {
  return [
    {
      id: "poNumber",
      meta: { titleKey: "purchasing.orders.fields.number", stacked: true, type: "code" },
      accessorFn: (row) => row.poNumber,
      cell: ({ row }) => (
        <StackedCell
          primary={
            <SemanticValue kind="id" className="text-body font-medium">
              {row.original.poNumber}
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
      meta: { titleKey: "purchasing.orders.fields.supplier", stacked: true, type: "name" },
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
      meta: { titleKey: "purchasing.orders.fields.reference", defaultHidden: true },
      accessorFn: (row) => row.referenceNumber ?? "—",
    },
    {
      id: "status",
      meta: { titleKey: "purchasing.suppliers.fields.status" },
      cell: ({ row }) => (
        <StackedCell
          primary={<StatusCell status={row.original.status} />}
          secondary={<MoneyValue value={orderGrandTotal(row.original)} />}
        />
      ),
    },
    {
      id: "grandTotal",
      meta: { titleKey: "purchasing.orders.fields.grandTotal", defaultHidden: true },
      accessorFn: (row) => orderGrandTotal(row),
      cell: ({ row }) => <MoneyValue value={orderGrandTotal(row.original)} />,
    },
    {
      id: "createdAt",
      meta: { titleKey: "purchasing.orders.fields.date" },
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
      meta: { titleKey: "purchasing.orders.fields.createdBy", defaultHidden: true },
      accessorFn: (row) => (row.createdBy ? (handlers.usersById[row.createdBy] ?? "—") : "—"),
    },
    {
      id: "__actions",
      meta: { titleKey: "common.actions" },
      enableHiding: false,
      cell: ({ row }) => <ActionsCell row={row.original} handlers={handlers} />,
    },
  ];
}

export const orderExportColumns = [
  "poNumber",
  "supplier",
  "referenceNumber",
  "grandTotal",
  "status",
  "createdAt",
  "createdBy",
];
