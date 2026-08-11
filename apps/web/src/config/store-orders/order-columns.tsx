"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { Eye } from "lucide-react";
import { StatusBadge } from "@/components/business/status-badge";
import { EnterpriseButton } from "@/components/ui/button";
import { formatDate } from "@/lib/date";
import { useLocale } from "@/providers/locale-provider";
import type { StoreOrderRow } from "@/services/store-orders-service";
import {
  PAYMENT_STATUS_LABEL_KEY,
  PAYMENT_STATUS_TONE,
  SHIPPING_STAGE_LABEL_KEY,
  SHIPPING_STAGE_TONE,
} from "./status";

function PaymentStatusCell({ status }: { status: StoreOrderRow["paymentStatus"] }) {
  const { t } = useLocale();
  return (
    <StatusBadge label={t(PAYMENT_STATUS_LABEL_KEY[status])} tone={PAYMENT_STATUS_TONE[status]} />
  );
}

function ShippingStageCell({ stage }: { stage: StoreOrderRow["shippingStage"] }) {
  const { t } = useLocale();
  return (
    <StatusBadge label={t(SHIPPING_STAGE_LABEL_KEY[stage])} tone={SHIPPING_STAGE_TONE[stage]} />
  );
}

function MoneyCell({
  value,
  currency,
}: {
  value: string;
  currency: string | { code: string } | null;
}) {
  const code = typeof currency === "string" ? currency : (currency?.code ?? "");
  return (
    <span dir="ltr">
      {Number(value).toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}{" "}
      {code}
    </span>
  );
}

export interface StoreOrderRowHandlers {
  onView: (row: StoreOrderRow) => void;
}

function ActionsCell({ row, handlers }: { row: StoreOrderRow; handlers: StoreOrderRowHandlers }) {
  const { t } = useLocale();
  return (
    <EnterpriseButton
      type="button"
      variant="ghost"
      size="icon-sm"
      aria-label={t("storeOrders.open")}
      onClick={() => handlers.onView(row)}
    >
      <Eye className="size-3.5" />
    </EnterpriseButton>
  );
}

export function buildStoreOrderColumns(
  handlers: StoreOrderRowHandlers,
): ColumnDef<StoreOrderRow, unknown>[] {
  return [
    {
      id: "internalOrderId",
      meta: { titleKey: "storeOrders.fields.internalOrderId" },
      accessorFn: (row) => row.internalOrderId,
      cell: (info) => (
        <code dir="ltr" className="rounded bg-muted px-1.5 py-0.5 text-xs">
          {info.getValue() as string}
        </code>
      ),
    },
    {
      id: "externalOrderId",
      meta: { titleKey: "storeOrders.fields.externalOrderId" },
      accessorFn: (row) => row.externalOrderId ?? "—",
      cell: (info) => (
        <span dir="ltr" className="text-caption">
          {info.getValue() as string}
        </span>
      ),
    },
    {
      id: "customer",
      meta: { titleKey: "storeOrders.fields.customer" },
      accessorFn: (row) => row.customer?.name ?? "—",
      cell: ({ row }) => (
        <div className="flex flex-col">
          <span className="font-medium">{row.original.customer?.name ?? "—"}</span>
          {row.original.customer?.phone && (
            <span dir="ltr" className="text-caption text-muted-foreground">
              {row.original.customer.phone}
            </span>
          )}
        </div>
      ),
    },
    {
      id: "orderDate",
      meta: { titleKey: "storeOrders.fields.orderDate" },
      accessorFn: (row) => formatDate(row.orderDate),
    },
    {
      id: "paymentStatus",
      meta: { titleKey: "storeOrders.fields.paymentStatus" },
      enableSorting: false,
      cell: ({ row }) => <PaymentStatusCell status={row.original.paymentStatus} />,
    },
    {
      id: "shippingStage",
      meta: { titleKey: "storeOrders.fields.shippingStage" },
      enableSorting: false,
      cell: ({ row }) => <ShippingStageCell stage={row.original.shippingStage} />,
    },
    {
      id: "total",
      meta: { titleKey: "storeOrders.fields.total" },
      accessorFn: (row) => row.total ?? "0",
      cell: ({ row }) => (
        <MoneyCell value={row.original.total ?? "0"} currency={row.original.currency} />
      ),
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

export const storeOrderExportColumns = [
  "internalOrderId",
  "externalOrderId",
  "customer",
  "orderDate",
  "paymentStatus",
  "shippingStage",
  "total",
];
