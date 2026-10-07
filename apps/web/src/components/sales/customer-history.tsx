"use client";

import Link from "next/link";
import { Ban, CheckCircle2, PackagePlus, Undo2, Wallet, type LucideIcon } from "lucide-react";
import { DetailField, DetailSection, DetailSummaryBar } from "@/components/shared/detail-workspace";
import { StatusBadge } from "@/components/business/status-badge";
import { Timeline, type TimelineEntry } from "@/components/business/timeline";
import { MoneyValue } from "@/components/shared/money-value";
import { EnterpriseButton } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  fulfillmentStatusTone,
  orderPaymentBadge,
} from "@/config/store-orders/order-status-badges";
import { ORDER_STATUS_LABEL_KEY, ORDER_STATUS_TONE } from "@/config/sales/order-status";
import { paymentRecordStatusBadge } from "@/config/store-orders/status";
import {
  historyOrderHref,
  type CustomerHistory,
  type CustomerHistoryOrder,
  type CustomerTimelineKind,
} from "@/services/customer-history-service";
import type { SalesDocumentStatusValue } from "@/services/sales-orders-service";
import { useLocale } from "@/providers/locale-provider";
import { formatDate, formatDateTime } from "@/lib/date";
import { formatMoney } from "@/lib/money";

/**
 * Round 14 (spec-4 §3) — the customer page's history views, built only from
 * `GET /customers/:partnerId/history` (the server already applied the
 * viewer's sales scope and the financial permission). Shared building blocks
 * only: `DetailSummaryBar`, the ui `Table` (stacked cards on phones),
 * `StatusBadge` with the existing status mappers, and `Timeline`.
 */

/** Placed / completed / last order date / outstanding (only when the server sent financials). */
export function CustomerHistorySummary({ history }: { history: CustomerHistory }) {
  const { t } = useLocale();
  const { summary, financials } = history;
  return (
    <DetailSummaryBar>
      <DetailField
        label={t("customerHistory.summary.placed")}
        value={<span className="num">{summary.placedOrders}</span>}
      />
      <DetailField
        label={t("customerHistory.summary.completed")}
        value={<span className="num">{summary.completedPurchases}</span>}
      />
      <DetailField
        label={t("customerHistory.summary.lastOrder")}
        value={summary.lastOrderDate ? formatDate(summary.lastOrderDate) : null}
      />
      {financials ? (
        <DetailField
          label={t("customerHistory.summary.outstanding")}
          value={
            <MoneyValue value={financials.outstandingBalance} currency={financials.currencyCode} />
          }
        />
      ) : null}
    </DetailSummaryBar>
  );
}

/** Store + B2B orders the viewer can open, newest first; the rest only as a count. */
export function CustomerOrdersSection({
  history,
  isLoading,
  failed,
}: {
  history: CustomerHistory | null;
  isLoading: boolean;
  failed: boolean;
}) {
  const { t } = useLocale();
  if (isLoading) {
    return <p className="text-caption text-muted-foreground">{t("common.loading")}</p>;
  }
  if (failed || !history) {
    return (
      <p className="text-caption text-destructive" role="alert">
        {t("customerHistory.orders.loadFailed")}
      </p>
    );
  }
  const others =
    history.otherOrdersCount > 0 ? (
      <p className="text-caption text-muted-foreground" data-testid="customer-other-orders">
        {t("customerHistory.orders.otherOrders", { count: history.otherOrdersCount })}
      </p>
    ) : null;
  if (history.orders.length === 0) {
    return (
      <DetailSection>
        <div className="flex flex-col gap-1">
          <p className="text-caption text-muted-foreground">{t("customerHistory.orders.empty")}</p>
          {others}
        </div>
      </DetailSection>
    );
  }
  return (
    <DetailSection>
      <div className="flex flex-col gap-2">
        {/* One DOM for every width: a table on sm+, each row a stacked card on phones. */}
        <div className="rounded-sm sm:border sm:border-border">
          <Table
            data-testid="customer-orders-table"
            className="max-sm:block"
            containerClassName="max-sm:overflow-visible"
          >
            <TableHeader className="max-sm:hidden">
              <TableRow>
                <TableHead>{t("customerHistory.orders.columns.number")}</TableHead>
                <TableHead>{t("customerHistory.orders.columns.date")}</TableHead>
                <TableHead>{t("customerHistory.orders.columns.products")}</TableHead>
                <TableHead>{t("customerHistory.orders.columns.fulfillment")}</TableHead>
                <TableHead>{t("customerHistory.orders.columns.payment")}</TableHead>
                <TableHead className="text-end">
                  {t("customerHistory.orders.columns.total")}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody className="max-sm:flex max-sm:flex-col max-sm:gap-2">
              {history.orders.map((order) => (
                <CustomerOrderRow key={`${order.type}-${order.id}`} order={order} />
              ))}
            </TableBody>
          </Table>
        </div>
        {others}
      </div>
    </DetailSection>
  );
}

function CustomerOrderRow({ order }: { order: CustomerHistoryOrder }) {
  const { t, locale } = useLocale();
  const cell = "align-top max-sm:p-0";
  const fulfillment = order.fulfillmentStatus
    ? {
        label:
          locale === "en"
            ? (order.fulfillmentStatus.nameEn ?? order.fulfillmentStatus.name)
            : order.fulfillmentStatus.name,
        tone: fulfillmentStatusTone(order.fulfillmentStatus.code),
      }
    : order.documentStatus
      ? {
          label: t(ORDER_STATUS_LABEL_KEY[order.documentStatus as SalesDocumentStatusValue]),
          tone: ORDER_STATUS_TONE[order.documentStatus as SalesDocumentStatusValue],
        }
      : null;
  const payment = order.paymentStatus
    ? orderPaymentBadge({ paymentStatus: order.paymentStatus })
    : null;
  return (
    <TableRow className="max-sm:flex max-sm:flex-col max-sm:gap-1.5 max-sm:rounded-sm max-sm:border max-sm:border-border max-sm:p-3">
      <TableCell className={cell}>
        <div className="flex flex-col">
          <EnterpriseButton asChild variant="link" size="inline" className="justify-start">
            <Link href={historyOrderHref(order)} dir="ltr">
              {order.number}
            </Link>
          </EnterpriseButton>
          <span className="text-caption text-muted-foreground">
            {t(`customerHistory.orders.type.${order.type}`)}
          </span>
        </div>
      </TableCell>
      <TableCell className={cell}>
        <span className="num text-muted-foreground">{formatDate(order.date)}</span>
      </TableCell>
      <TableCell className={`${cell} max-w-64`}>
        <bdi className="line-clamp-2 [overflow-wrap:anywhere]" title={order.productSummary}>
          {order.productSummary || "—"}
        </bdi>
      </TableCell>
      <TableCell className={cell}>
        {fulfillment ? <StatusBadge label={fulfillment.label} tone={fulfillment.tone} /> : "—"}
      </TableCell>
      <TableCell className={cell}>
        {payment ? (
          <StatusBadge
            label={payment.labelKey ? t(payment.labelKey) : (payment.label ?? "")}
            tone={payment.tone}
          />
        ) : (
          "—"
        )}
      </TableCell>
      <TableCell className={`${cell} text-end max-sm:text-start`}>
        <MoneyValue value={order.total} currency={order.currencyCode} />
      </TableCell>
    </TableRow>
  );
}

/** Payments recorded on the customer's orders — rendered only when the server sent financials. */
export function CustomerOrderCollections({
  financials,
}: {
  financials: NonNullable<CustomerHistory["financials"]>;
}) {
  const { t } = useLocale();
  return (
    <DetailSection title={t("customerHistory.payments.title")}>
      {financials.payments.length === 0 ? (
        <p className="text-caption text-muted-foreground">{t("customerHistory.payments.empty")}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {financials.payments.map((payment) => {
            const badge = paymentRecordStatusBadge(payment.status);
            return (
              <li
                key={payment.id}
                className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2"
              >
                <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
                  <span dir="ltr" className="num font-medium">
                    {payment.number}
                  </span>
                  <span className="text-caption text-muted-foreground">
                    {formatDate(payment.date)}
                  </span>
                  {payment.orderId && payment.orderNumber ? (
                    <EnterpriseButton asChild variant="link" size="inline">
                      <Link href={`/store-orders/${payment.orderId}`} dir="ltr">
                        {payment.orderNumber}
                      </Link>
                    </EnterpriseButton>
                  ) : null}
                </span>
                <span className="flex items-center gap-2">
                  <StatusBadge
                    label={badge.labelKey ? t(badge.labelKey) : badge.fallback}
                    tone={badge.tone}
                  />
                  <MoneyValue value={payment.amount} currency={payment.currencyCode} />
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </DetailSection>
  );
}

const TIMELINE_ICON: Record<CustomerTimelineKind, LucideIcon> = {
  ORDER: PackagePlus,
  DELIVERY: CheckCircle2,
  RETURN: Undo2,
  CANCELLATION: Ban,
  PAYMENT: Wallet,
};

/** Orders, deliveries, returns, cancellations and (with permission) payments — newest first, plain labels. */
export function CustomerHistoryTimeline({ history }: { history: CustomerHistory }) {
  const { t } = useLocale();
  if (history.timeline.length === 0) {
    return (
      <p className="text-caption text-muted-foreground">{t("customerHistory.timeline.empty")}</p>
    );
  }
  const entries: TimelineEntry[] = history.timeline.map((event, index) => ({
    id: `${event.kind}-${event.reference}-${index}`,
    title: t(`customerHistory.timeline.kind.${event.kind}`),
    description:
      event.kind === "PAYMENT" && event.amount !== undefined
        ? `${event.reference} · ${formatMoney(event.amount, event.currencyCode ?? null)}`
        : event.reference,
    timestamp: formatDateTime(event.at),
    icon: TIMELINE_ICON[event.kind],
  }));
  return (
    <DetailSection>
      <Timeline entries={entries} />
    </DetailSection>
  );
}
