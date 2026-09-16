"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { formatDate, formatTime, hasClockTime } from "@/lib/date";
import { formatMoney, currencyCodeOf } from "@/lib/money";
import type { ExportColumn } from "@/components/shared/export-dialog";
import type { MessageKey } from "@/i18n/translate";
import type { StoreOrderRow } from "@/services/store-orders-service";
import { StatusBadge } from "@/components/business/status-badge";
import { PAYMENT_STATUS_LABEL_KEY, SHIPPING_STAGE_LABEL_KEY } from "./status";
import { Archive, Eye, Pencil } from "lucide-react";
import { RowActionsMenu } from "@/components/shared/data-table";
import { useLocale } from "@/providers/locale-provider";
import { useUserContext } from "@/providers/user-context";
import {
  StoreOrderCustomerCell,
  StoreOrderDateCell,
  StoreOrderIdentityCell,
  StoreOrderPaymentCell,
  StoreOrderShippingCell,
  customerPhone,
  latestShipment,
} from "@/components/store-orders/store-order-row-cells";

export interface StoreOrderRowHandlers {
  onView: (row: StoreOrderRow) => void;
  onEdit?: (row: StoreOrderRow) => void;
  onArchive?: (row: StoreOrderRow) => void;
  /** ADR-0018 (M2 gap closure) — adds the default-hidden profitability columns; only pass true when the caller both requested and was authorized for `orders.profitability.view` (the page decides, never this config). */
  includeProfitability?: boolean;
}

const COST_STATE_TONE: Record<string, "success" | "warning" | "neutral"> = {
  COMPLETE: "success",
  PARTIAL: "warning",
  UNKNOWN: "neutral",
};

function CostStateCell({ order }: { order: StoreOrderRow }) {
  const { t } = useLocale();
  const state = order.profitability?.costState;
  if (!state) return <span className="text-muted-foreground">—</span>;
  return (
    <StatusBadge
      label={t(`storeOrders.profitability.costStateValues.${state}` as MessageKey)}
      tone={COST_STATE_TONE[state]}
    />
  );
}

function money(value: number | null | undefined, currency: StoreOrderRow["currency"]) {
  if (value == null) return "—";
  return formatMoney(value, currencyCodeOf(currency));
}

function percent(value: number | null | undefined) {
  if (value == null) return "—";
  return `${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
}

function StoreOrderActionsCell({
  order,
  onView,
  onEdit,
  onArchive,
}: {
  order: StoreOrderRow;
  onView: (row: StoreOrderRow) => void;
  onEdit?: (row: StoreOrderRow) => void;
  onArchive?: (row: StoreOrderRow) => void;
}) {
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
          hidden: !hasPermission("store-orders.view"),
          onSelect: () => onView(order),
        },
        {
          key: "edit",
          label: t("common.edit"),
          icon: Pencil,
          hidden: !onEdit || !hasPermission("store-orders.edit"),
          onSelect: () => onEdit?.(order),
        },
        {
          key: "archive",
          label: t("common.archive"),
          icon: Archive,
          hidden: !onArchive || !hasPermission("store-orders.archive"),
          destructive: true,
          separatorBefore: true,
          onSelect: () => onArchive?.(order),
        },
      ]}
    />
  );
}

export function buildStoreOrderColumns(
  handlers: StoreOrderRowHandlers,
): ColumnDef<StoreOrderRow, unknown>[] {
  return [
    {
      id: "internalOrderId",
      meta: {
        titleKey: "storeOrders.fields.order",
        stacked: true,
        type: "code",
        identity: true,
        importance: "critical",
        minWidth: 148,
        maxWidth: 220,
        grow: 1.5,
      },
      accessorFn: (row) =>
        row.externalOrderId ? `${row.internalOrderId} ${row.externalOrderId}` : row.internalOrderId,
      cell: ({ row }) => <StoreOrderIdentityCell order={row.original} />,
    },
    {
      id: "customer",
      meta: {
        titleKey: "storeOrders.fields.customer",
        stacked: true,
        type: "name",
        importance: "critical",
        minWidth: 180,
        maxWidth: 320,
      },
      enableSorting: false,
      accessorFn: (row) => {
        const phone = customerPhone(row);
        return phone ? `${row.partner?.name ?? "—"} ${phone}` : (row.partner?.name ?? "—");
      },
      cell: ({ row }) => <StoreOrderCustomerCell order={row.original} />,
    },
    {
      id: "orderDate",
      meta: {
        titleKey: "storeOrders.fields.orderDate",
        stacked: true,
        type: "date",
        importance: "high",
        minWidth: 118,
        maxWidth: 160,
      },
      accessorFn: (row) => {
        const date = formatDate(row.orderDate);
        return hasClockTime(row.orderDate) ? `${date} ${formatTime(row.orderDate)}` : date;
      },
      cell: ({ row }) => <StoreOrderDateCell order={row.original} />,
    },
    {
      id: "paymentStatus",
      meta: {
        titleKey: "storeOrders.fields.payment",
        stacked: true,
        type: "status",
        importance: "high",
        minWidth: 148,
        maxWidth: 220,
        grow: 1.4,
      },
      accessorFn: (row) =>
        `${row.paymentStatus} ${formatMoney(row.total ?? "0", currencyCodeOf(row.currency))}`,
      cell: ({ row }) => <StoreOrderPaymentCell order={row.original} />,
    },
    {
      id: "shippingStage",
      meta: {
        titleKey: "storeOrders.fields.shipping",
        stacked: true,
        type: "status",
        importance: "medium",
        minWidth: 140,
        maxWidth: 220,
        grow: 1.4,
      },
      accessorFn: (row) => {
        const tracking = latestShipment(row)?.trackingNumber;
        return tracking ? `${row.shippingStage} ${tracking}` : row.shippingStage;
      },
      cell: ({ row }) => <StoreOrderShippingCell order={row.original} />,
    },
    ...(handlers.includeProfitability
      ? ([
          {
            id: "netRevenue",
            meta: {
              titleKey: "storeOrders.profitability.netRevenue",
              defaultHidden: true,
              align: "end",
              type: "number",
            },
            accessorFn: (row) => row.profitability?.netRevenue ?? "",
            cell: ({ row }) => money(row.original.profitability?.netRevenue, row.original.currency),
          },
          {
            id: "cogs",
            meta: {
              titleKey: "storeOrders.profitability.cogs",
              defaultHidden: true,
              align: "end",
              type: "number",
            },
            accessorFn: (row) => row.profitability?.cogs ?? "",
            cell: ({ row }) => money(row.original.profitability?.cogs, row.original.currency),
          },
          {
            id: "grossProductProfit",
            meta: {
              titleKey: "storeOrders.profitability.grossProductProfit",
              defaultHidden: true,
              align: "end",
              type: "number",
            },
            accessorFn: (row) => row.profitability?.grossProductProfit ?? "",
            cell: ({ row }) =>
              money(row.original.profitability?.grossProductProfit, row.original.currency),
          },
          {
            id: "contributionProfit",
            meta: {
              titleKey: "storeOrders.profitability.contributionProfit",
              defaultHidden: true,
              align: "end",
              type: "number",
            },
            accessorFn: (row) => row.profitability?.contributionProfit ?? "",
            cell: ({ row }) =>
              money(row.original.profitability?.contributionProfit, row.original.currency),
          },
          {
            id: "contributionMarginPercent",
            meta: {
              titleKey: "storeOrders.profitability.contributionMargin",
              defaultHidden: true,
              align: "end",
              type: "number",
            },
            accessorFn: (row) => row.profitability?.contributionMarginPercent ?? "",
            cell: ({ row }) => percent(row.original.profitability?.contributionMarginPercent),
          },
          {
            id: "costState",
            meta: { titleKey: "storeOrders.profitability.costState", defaultHidden: true },
            accessorFn: (row) => row.profitability?.costState ?? "",
            cell: ({ row }) => <CostStateCell order={row.original} />,
          },
        ] satisfies ColumnDef<StoreOrderRow, unknown>[])
      : []),
    {
      id: "__actions",
      meta: { titleKey: "common.actions", importance: "critical" },
      enableHiding: false,
      enableSorting: false,
      cell: ({ row }) => (
        <StoreOrderActionsCell
          order={row.original}
          onView={handlers.onView}
          onEdit={handlers.onEdit}
          onArchive={handlers.onArchive}
        />
      ),
    },
  ];
}

const EXPORT_FIELDS: { key: string; titleKey: MessageKey }[] = [
  { key: "internalOrderId", titleKey: "storeOrders.fields.internalOrderId" },
  { key: "externalOrderId", titleKey: "storeOrders.fields.externalOrderId" },
  { key: "customer", titleKey: "storeOrders.fields.customer" },
  { key: "phone", titleKey: "storeOrders.fields.phone" },
  { key: "orderDate", titleKey: "storeOrders.fields.orderDate" },
  { key: "paymentStatus", titleKey: "storeOrders.fields.paymentStatus" },
  { key: "shippingStage", titleKey: "storeOrders.fields.shippingStage" },
  { key: "total", titleKey: "storeOrders.fields.total" },
];

export const storeOrderExportColumns = EXPORT_FIELDS.map((field) => field.key);

export function storeOrderExportColumnList(t: (key: MessageKey) => string): ExportColumn[] {
  return EXPORT_FIELDS.map((field) => ({ key: field.key, label: t(field.titleKey) }));
}

export function storeOrderPrintRow(
  item: StoreOrderRow,
  t: (key: MessageKey) => string,
): Record<string, string> {
  return {
    internalOrderId: item.internalOrderId,
    externalOrderId: item.externalOrderId ?? "",
    customer: item.partner?.name ?? "",
    phone: customerPhone(item) ?? "",
    orderDate: formatDate(item.orderDate),
    paymentStatus: t(PAYMENT_STATUS_LABEL_KEY[item.paymentStatus]),
    shippingStage: t(SHIPPING_STAGE_LABEL_KEY[item.shippingStage]),
    total: formatMoney(item.total ?? "0", currencyCodeOf(item.currency)),
  };
}
