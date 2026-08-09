"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { Archive, Ban, Copy, Eye, Pencil, Printer } from "lucide-react";
import { StatusBadge } from "@/components/business/status-badge";
import { formatDate } from "@/lib/date";
import { useLocale } from "@/providers/locale-provider";
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

function MoneyCell({ value }: { value: number }) {
  return (
    <span dir="ltr">
      {value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
    </span>
  );
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
  const isDraft = row.status === "DRAFT";
  const actions: SalesDocumentRowAction[] = [
    {
      key: "view",
      label: t("purchasing.orders.open"),
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
      label: t("purchasing.orders.actions.cancel"),
      icon: Ban,
      hidden: !ORDER_CANCELLABLE_STATUSES.includes(row.status),
      destructive: true,
      separatorBefore: true,
      onSelect: () => handlers.onCancel(row),
    },
    {
      key: "archive",
      label: t("common.archive"),
      icon: Archive,
      hidden: !ORDER_ARCHIVABLE_STATUSES.includes(row.status),
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
      meta: { titleKey: "purchasing.orders.fields.number" },
      accessorFn: (row) => row.poNumber,
      cell: (info) => (
        <code dir="ltr" className="rounded bg-muted px-1.5 py-0.5 text-xs">
          {info.getValue() as string}
        </code>
      ),
    },
    {
      id: "supplier",
      meta: { titleKey: "purchasing.orders.fields.supplier" },
      accessorFn: (row) => row.supplier?.name ?? "—",
      cell: (info) => <span className="font-medium">{info.getValue() as string}</span>,
    },
    {
      id: "referenceNumber",
      meta: { titleKey: "purchasing.orders.fields.reference" },
      accessorFn: (row) => row.referenceNumber ?? "—",
    },
    {
      id: "grandTotal",
      meta: { titleKey: "purchasing.orders.fields.grandTotal" },
      accessorFn: (row) => row.items.reduce((sum, item) => sum + Number(item.subtotal), 0),
      cell: (info) => <MoneyCell value={info.getValue() as number} />,
    },
    {
      id: "status",
      meta: { titleKey: "purchasing.suppliers.fields.status" },
      cell: ({ row }) => <StatusCell status={row.original.status} />,
    },
    {
      id: "createdAt",
      meta: { titleKey: "purchasing.orders.fields.date" },
      accessorFn: (row) => formatDate(row.createdAt),
    },
    {
      id: "createdBy",
      meta: { titleKey: "purchasing.orders.fields.createdBy" },
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
