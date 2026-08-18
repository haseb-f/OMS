"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { Eye, Truck } from "lucide-react";
import { StatusBadge } from "@/components/business/status-badge";
import { RowActionsMenu } from "@/components/shared/data-table";
import { SemanticValue } from "@/components/shared/semantic-value";
import { StackedCell } from "@/components/shared/stacked-cell";
import { EnterpriseBadge } from "@/components/ui/badge";
import { formatDate } from "@/lib/date";
import { useLocale } from "@/providers/locale-provider";
import { useUserContext } from "@/providers/user-context";
import type { ShipmentListRow } from "@/services/shipping-service";
import { shipmentStatusLabelKey, shipmentStatusTone } from "./shipment-status";

function StatusCell({ status }: { status: ShipmentListRow["status"] }) {
  const { t } = useLocale();
  return (
    <StatusBadge label={t(shipmentStatusLabelKey(status))} tone={shipmentStatusTone(status)} />
  );
}

export interface ShipmentRowHandlers {
  onView: (row: ShipmentListRow) => void;
  onManage: (row: ShipmentListRow) => void;
}

function ActionsCell({ row, handlers }: { row: ShipmentListRow; handlers: ShipmentRowHandlers }) {
  const { t } = useLocale();
  const { hasPermission } = useUserContext();
  return (
    <RowActionsMenu
      label={t("common.actions")}
      actions={[
        {
          key: "view",
          label: t("common.view"),
          icon: Eye,
          hidden: !hasPermission("shipping.view"),
          onSelect: () => handlers.onView(row),
        },
        {
          key: "manage",
          label: t("shipping.manage.title"),
          icon: Truck,
          hidden: !hasPermission("shipping.manage"),
          onSelect: () => handlers.onManage(row),
        },
      ]}
    />
  );
}

export function buildShipmentColumns(
  handlers: ShipmentRowHandlers,
): ColumnDef<ShipmentListRow, unknown>[] {
  return [
    {
      id: "internalOrderId",
      meta: { titleKey: "shipping.fields.internalOrderId", stacked: true, type: "code" },
      accessorFn: (row) => row.storeOrder.internalOrderId,
      cell: ({ row }) => (
        <StackedCell
          primary={
            <SemanticValue kind="id" className="text-body font-medium">
              {row.original.storeOrder.internalOrderId}
            </SemanticValue>
          }
          secondary={
            row.original.storeOrder.externalOrderId ? (
              <SemanticValue kind="id">{row.original.storeOrder.externalOrderId}</SemanticValue>
            ) : undefined
          }
        />
      ),
    },
    {
      id: "externalOrderId",
      meta: { titleKey: "shipping.fields.externalOrderId", defaultHidden: true },
      accessorFn: (row) => row.storeOrder.externalOrderId ?? "—",
      cell: (info) => (
        <span dir="ltr" className="text-caption">
          {info.getValue() as string}
        </span>
      ),
    },
    {
      id: "customer",
      meta: { titleKey: "shipping.fields.customer", stacked: true, type: "name" },
      accessorFn: (row) => row.storeOrder.customer?.name ?? "—",
      cell: ({ row }) => (
        <StackedCell
          primary={row.original.storeOrder.customer?.name ?? "—"}
          secondary={
            row.original.storeOrder.customer?.phone ? (
              <SemanticValue kind="phone">{row.original.storeOrder.customer.phone}</SemanticValue>
            ) : undefined
          }
        />
      ),
    },
    {
      id: "shippingCompany",
      meta: { titleKey: "shipping.fields.shippingCompany", stacked: true, type: "name" },
      accessorFn: (row) => row.shippingCompany?.name ?? "—",
      cell: ({ row }) => (
        <StackedCell
          primary={row.original.shippingCompany?.name ?? "—"}
          secondary={
            row.original.trackingNumber ? (
              <SemanticValue kind="id">{row.original.trackingNumber}</SemanticValue>
            ) : undefined
          }
        />
      ),
    },
    {
      id: "trackingNumber",
      meta: { titleKey: "shipping.fields.trackingNumber", defaultHidden: true },
      accessorFn: (row) => row.trackingNumber ?? "—",
      cell: (info) => (
        <span dir="ltr" className="text-caption">
          {info.getValue() as string}
        </span>
      ),
    },
    {
      id: "status",
      meta: { titleKey: "shipping.fields.status" },
      enableSorting: false,
      cell: ({ row }) => (
        <div className="flex items-center gap-1.5">
          <StatusCell status={row.original.status} />
          {row.original.attemptNumber > 1 && (
            <EnterpriseBadge variant="outline" className="text-xs">
              #{row.original.attemptNumber}
            </EnterpriseBadge>
          )}
        </div>
      ),
    },
    {
      id: "shippedAt",
      meta: { titleKey: "shipping.fields.shippedAt" },
      accessorFn: (row) => (row.shippedAt ? formatDate(row.shippedAt) : "—"),
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

export const shipmentExportColumns = [
  "internalOrderId",
  "externalOrderId",
  "customer",
  "shippingCompany",
  "trackingNumber",
  "status",
  "shippedAt",
];
