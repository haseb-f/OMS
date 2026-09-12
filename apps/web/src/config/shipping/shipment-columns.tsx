"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { Eye, Truck } from "lucide-react";
import { RowActionsMenu } from "@/components/shared/data-table";
import { SemanticValue } from "@/components/shared/semantic-value";
import { StackedCell } from "@/components/shared/stacked-cell";
import { ShipmentAttachmentsPopover } from "@/components/shipping/shipment-attachments-popover";
import { formatDate } from "@/lib/date";
import { useLocale } from "@/providers/locale-provider";
import { useUserContext } from "@/providers/user-context";
import type { ShipmentListRow } from "@/services/shipping-service";
import {
  ShippingCompanyQuickCell,
  ShippingStatusQuickCell,
  TrackingNumberQuickCell,
  type ShipmentQuickEditContext,
} from "./shipment-quick-edit-cells";

export interface ShipmentRowHandlers {
  onView: (row: ShipmentListRow) => void;
  onManage: (row: ShipmentListRow) => void;
  quickEdit: ShipmentQuickEditContext;
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
      meta: {
        titleKey: "shipping.fields.internalOrderId",
        stacked: true,
        type: "code",
        identity: true,
        importance: "critical",
      },
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
      accessorFn: (row) => row.storeOrder.partner?.name ?? "—",
      cell: ({ row }) => (
        <StackedCell
          primary={row.original.storeOrder.partner?.name ?? "—"}
          secondary={
            row.original.storeOrder.partner?.phone ? (
              <SemanticValue kind="phone">{row.original.storeOrder.partner.phone}</SemanticValue>
            ) : undefined
          }
        />
      ),
    },
    {
      id: "shippingCompany",
      meta: { titleKey: "shipping.fields.shippingCompany", type: "name" },
      accessorFn: (row) => row.shippingCompany?.name ?? "—",
      enableSorting: false,
      cell: ({ row }) => <ShippingCompanyQuickCell row={row.original} ctx={handlers.quickEdit} />,
    },
    {
      id: "trackingNumber",
      meta: { titleKey: "shipping.fields.trackingNumber" },
      accessorFn: (row) => row.trackingNumber ?? "—",
      enableSorting: false,
      cell: ({ row }) => <TrackingNumberQuickCell row={row.original} ctx={handlers.quickEdit} />,
    },
    {
      id: "status",
      meta: { titleKey: "shipping.fields.status" },
      enableSorting: false,
      cell: ({ row }) => <ShippingStatusQuickCell row={row.original} ctx={handlers.quickEdit} />,
    },
    {
      id: "shippingAttachments",
      meta: { titleKey: "shipping.fields.attachments" },
      enableHiding: false,
      enableSorting: false,
      cell: ({ row }) =>
        !row.original.isCurrentAttempt ? (
          <span className="text-muted-foreground">—</span>
        ) : (
          <ShipmentAttachmentsPopover
            storeOrderId={row.original.storeOrderId}
            count={row.original._count?.receiptAttachments ?? 0}
            canEdit={handlers.quickEdit.canEdit}
            onCountChanged={(nextCount) =>
              handlers.quickEdit.onPatched(row.original.id, {
                _count: { receiptAttachments: nextCount },
              })
            }
          />
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
