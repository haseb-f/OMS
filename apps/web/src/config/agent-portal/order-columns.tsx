"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { MoneyValue } from "@/components/shared/money-value";
import { SemanticValue } from "@/components/shared/semantic-value";
import { StackedCell } from "@/components/shared/stacked-cell";
import {
  DeclaredStatusBadge,
  FinanceStatusBadge,
  FulfillmentStatusBadge,
} from "@/components/agent-portal/portal-badges";
import { fulfillmentCodeLabelKey } from "@/config/agent-portal/labels";
import { formatDate } from "@/lib/date";
import { useLocale } from "@/providers/locale-provider";
import { formatMoney } from "@/lib/money";
import type { MessageKey } from "@/i18n/translate";
import type { PortalOrderRow } from "@/services/agent-portal-service";

function MethodCell({ method }: { method: PortalOrderRow["fulfillmentMethod"] }) {
  const { t } = useLocale();
  return <>{t(`agentPortal.status.method.${method}`)}</>;
}

/** Agent portal orders list (server mode) — read-only columns, no internal actions. */
export function buildPortalOrderColumns(): ColumnDef<PortalOrderRow, unknown>[] {
  return [
    {
      id: "number",
      meta: {
        titleKey: "agentPortal.orders.fields.number",
        type: "code",
        identity: true,
        importance: "critical",
      },
      enableSorting: false,
      accessorFn: (row) => row.internalOrderId,
    },
    {
      id: "date",
      meta: { titleKey: "agentPortal.orders.fields.date", type: "date" },
      enableSorting: false,
      accessorFn: (row) => row.orderDate,
      cell: ({ row }) => <span className="num">{formatDate(row.original.orderDate)}</span>,
    },
    {
      id: "customer",
      meta: {
        titleKey: "agentPortal.orders.fields.customer",
        type: "name",
        stacked: true,
        importance: "critical",
      },
      enableSorting: false,
      accessorFn: (row) => row.customer?.name ?? "",
      cell: ({ row }) => (
        <StackedCell
          primary={row.original.customer?.name ?? "—"}
          secondary={
            row.original.customer?.mobile ? (
              <SemanticValue kind="phone">{row.original.customer.mobile}</SemanticValue>
            ) : undefined
          }
        />
      ),
    },
    {
      id: "merchandise",
      meta: {
        titleKey: "agentPortal.orders.fields.merchandise",
        type: "money",
        importance: "medium",
      },
      enableSorting: false,
      accessorFn: (row) => row.breakdown.merchandiseAmount ?? "",
      cell: ({ row }) =>
        row.original.breakdown.merchandiseAmount == null ? (
          "—"
        ) : (
          <MoneyValue
            value={row.original.breakdown.merchandiseAmount}
            currency={row.original.currency}
          />
        ),
    },
    {
      id: "shipping",
      meta: { titleKey: "agentPortal.orders.fields.shipping", type: "money", importance: "medium" },
      enableSorting: false,
      accessorFn: (row) => row.breakdown.shippingCharge ?? "",
      cell: ({ row }) =>
        row.original.breakdown.shippingCharge == null ? (
          "—"
        ) : (
          <MoneyValue
            value={row.original.breakdown.shippingCharge}
            currency={row.original.currency}
          />
        ),
    },
    {
      id: "payable",
      meta: {
        titleKey: "agentPortal.orders.fields.payable",
        type: "money",
        importance: "critical",
      },
      enableSorting: false,
      accessorFn: (row) => row.breakdown.payableTotal,
      cell: ({ row }) => (
        <MoneyValue value={row.original.breakdown.payableTotal} currency={row.original.currency} />
      ),
    },
    {
      id: "declared",
      meta: { titleKey: "agentPortal.orders.fields.declared", type: "status" },
      enableSorting: false,
      accessorFn: (row) => row.declaredPaymentStatus,
      cell: ({ row }) => <DeclaredStatusBadge status={row.original.declaredPaymentStatus} />,
    },
    {
      id: "finance",
      meta: { titleKey: "agentPortal.orders.fields.finance", type: "status" },
      enableSorting: false,
      accessorFn: (row) => row.financePaymentStatus,
      cell: ({ row }) => <FinanceStatusBadge status={row.original.financePaymentStatus} />,
    },
    {
      id: "fulfillment",
      meta: {
        titleKey: "agentPortal.orders.fields.fulfillment",
        type: "status",
        importance: "high",
      },
      enableSorting: false,
      accessorFn: (row) => row.fulfillmentStatus?.code ?? "",
      cell: ({ row }) => <FulfillmentStatusBadge status={row.original.fulfillmentStatus} />,
    },
    {
      id: "method",
      meta: { titleKey: "agentPortal.orders.fields.method", defaultHidden: true },
      enableSorting: false,
      accessorFn: (row) => row.fulfillmentMethod,
      cell: ({ row }) => <MethodCell method={row.original.fulfillmentMethod} />,
    },
  ];
}

export const PORTAL_ORDER_EXPORT_COLUMNS = [
  "number",
  "date",
  "customer",
  "merchandise",
  "shipping",
  "payable",
  "declared",
  "finance",
  "fulfillment",
  "method",
];

/** Plain-text export / print row in the UI language. */
export function portalOrderExportRow(
  row: PortalOrderRow,
  t: (key: MessageKey) => string,
  locale: "ar" | "en",
): Record<string, string> {
  const code = row.currency?.code ?? null;
  const fulfillmentKey = fulfillmentCodeLabelKey(row.fulfillmentStatus?.code);
  return {
    number: row.internalOrderId,
    date: formatDate(row.orderDate),
    customer: [row.customer?.name, row.customer?.mobile].filter(Boolean).join(" · "),
    merchandise:
      row.breakdown.merchandiseAmount == null
        ? ""
        : formatMoney(row.breakdown.merchandiseAmount, code),
    shipping:
      row.breakdown.shippingCharge == null ? "" : formatMoney(row.breakdown.shippingCharge, code),
    payable: formatMoney(row.breakdown.payableTotal, code),
    declared: t(`agentPortal.status.declared.${row.declaredPaymentStatus}` as MessageKey),
    finance: t(`agentPortal.status.finance.${row.financePaymentStatus}` as MessageKey),
    fulfillment: fulfillmentKey
      ? t(fulfillmentKey)
      : ((locale === "en" ? row.fulfillmentStatus?.nameEn : null) ??
        row.fulfillmentStatus?.name ??
        ""),
    method: t(`agentPortal.status.method.${row.fulfillmentMethod}` as MessageKey),
  };
}
