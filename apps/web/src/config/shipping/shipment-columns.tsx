"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { Eye } from "lucide-react";
import { StatusBadge } from "@/components/business/status-badge";
import { EnterpriseBadge } from "@/components/ui/badge";
import { EnterpriseButton } from "@/components/ui/button";
import { formatDate } from "@/lib/date";
import { useLocale } from "@/providers/locale-provider";
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
}

function ActionsCell({ row, handlers }: { row: ShipmentListRow; handlers: ShipmentRowHandlers }) {
  const { t } = useLocale();
  return (
    <EnterpriseButton
      type="button"
      variant="ghost"
      size="icon-sm"
      aria-label={t("shipping.open")}
      onClick={() => handlers.onView(row)}
    >
      <Eye className="size-3.5" />
    </EnterpriseButton>
  );
}

export function buildShipmentColumns(
  handlers: ShipmentRowHandlers,
): ColumnDef<ShipmentListRow, unknown>[] {
  return [
    {
      id: "internalOrderId",
      meta: { titleKey: "shipping.fields.internalOrderId" },
      accessorFn: (row) => row.storeOrder.internalOrderId,
      cell: (info) => (
        <code dir="ltr" className="rounded bg-muted px-1.5 py-0.5 text-xs">
          {info.getValue() as string}
        </code>
      ),
    },
    {
      id: "externalOrderId",
      meta: { titleKey: "shipping.fields.externalOrderId" },
      accessorFn: (row) => row.storeOrder.externalOrderId ?? "—",
      cell: (info) => (
        <span dir="ltr" className="text-caption">
          {info.getValue() as string}
        </span>
      ),
    },
    {
      id: "customer",
      meta: { titleKey: "shipping.fields.customer" },
      accessorFn: (row) => row.storeOrder.customer?.name ?? "—",
      cell: ({ row }) => (
        <div className="flex flex-col">
          <span className="font-medium">{row.original.storeOrder.customer?.name ?? "—"}</span>
          {row.original.storeOrder.customer?.phone && (
            <span dir="ltr" className="text-caption text-muted-foreground">
              {row.original.storeOrder.customer.phone}
            </span>
          )}
        </div>
      ),
    },
    {
      id: "shippingCompany",
      meta: { titleKey: "shipping.fields.shippingCompany" },
      accessorFn: (row) => row.shippingCompany?.name ?? "—",
    },
    {
      id: "trackingNumber",
      meta: { titleKey: "shipping.fields.trackingNumber" },
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
