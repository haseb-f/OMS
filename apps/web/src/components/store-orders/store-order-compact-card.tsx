"use client";

import type { ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import { StatusBadge } from "@/components/business/status-badge";
import { CompactDetailTable } from "@/components/shared/data-table";
import { MoneyValue } from "@/components/shared/money-value";
import { SemanticValue } from "@/components/shared/semantic-value";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { agentOrderBreakdown } from "@/config/agents/agent-order";
import type { MessageKey } from "@/i18n/translate";
import { useLocale } from "@/providers/locale-provider";
import type { StoreOrderRow } from "@/services/store-orders-service";

const lineAmount = (item: StoreOrderRow["items"][number]) =>
  item.agreedAmount != null ? Number(item.agreedAmount) : Number(item.unitPrice) * item.quantity;

/** Spec 2 pricing state of the customer shipping line (agent orders). */
function shippingStateKey(order: StoreOrderRow): MessageKey | null {
  if (order.customerTotalStatus === "CONFIRMATION_REQUIRED") {
    return "orderAmendments.detail.shippingState.PENDING_CUSTOMER";
  }
  if (order.shippingPricingStatus === "PENDING_METHOD") {
    return "orderAmendments.detail.shippingState.PROVISIONAL";
  }
  if (order.shippingPricingStatus === "CONFIRMED") {
    return "orderAmendments.detail.shippingState.CONFIRMED";
  }
  return null;
}

function Row({
  label,
  children,
  emphasis,
}: {
  label: ReactNode;
  children: ReactNode;
  emphasis?: boolean;
}) {
  return (
    <div className="flex min-w-0 items-baseline justify-between gap-3 py-1">
      <dt
        className={
          emphasis ? "text-caption font-semibold" : "min-w-0 text-caption text-muted-foreground"
        }
      >
        {label}
      </dt>
      <dd className={emphasis ? "font-semibold" : undefined}>{children}</dd>
    </div>
  );
}

/**
 * Round 5 Spec 1C — the ONE compact order card: customer (name, phone,
 * destination), the items and the totals (merchandise, discount, shipping
 * with its pricing state, payable, paid, outstanding). Everything else on
 * the detail page is progressive disclosure below it.
 */
export function StoreOrderCompactCard({
  order,
  paid,
  outstanding,
  actions,
  notices,
}: {
  order: StoreOrderRow;
  /** Finance-confirmed amount. */
  paid: number;
  outstanding: number;
  /** Header actions (e.g. set amounts, duplicate review). */
  actions?: ReactNode;
  /** Inline notices (duplicate review, label reissue). */
  notices?: ReactNode;
}) {
  const { t } = useLocale();
  const currency = order.currency;
  const typed = order.agentId ? (order.agentTermsSnapshot?.customer ?? null) : null;
  const name = typed?.name ?? order.partner?.name;
  const phone = typed ? typed.mobile : order.partner?.phone || order.partner?.mobile || null;
  const destination = typed
    ? [typed.city, typed.address].filter(Boolean).join("، ")
    : [order.partner?.address, order.partner?.city].filter(Boolean).join("، ");
  const breakdown = agentOrderBreakdown(order);
  const stateKey = shippingStateKey(order);
  const total = Number(order.total ?? 0);
  const declared = Number(order.declaredAmount ?? 0);

  return (
    <section
      data-testid="order-compact-card"
      className="min-w-0 rounded-md border border-border bg-card"
    >
      <div className="flex min-h-10 items-center justify-between gap-2 border-b border-border/70 px-3 py-1.5">
        <h2 className="text-caption font-semibold tracking-tight">
          {t("orderAmendments.detail.card")}
        </h2>
        {actions ? <div className="flex flex-wrap items-center gap-1">{actions}</div> : null}
      </div>
      {notices ? <div className="flex flex-col gap-2 px-3 pt-2">{notices}</div> : null}

      <dl className="grid grid-cols-1 gap-x-4 gap-y-1 px-3 py-2 sm:grid-cols-3">
        <div className="min-w-0">
          <dt className="text-caption text-muted-foreground">{t("storeOrders.fields.customer")}</dt>
          <dd className="text-body font-medium [overflow-wrap:anywhere]">{name ?? "—"}</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-caption text-muted-foreground">{t("storeOrders.fields.phone")}</dt>
          <dd className="text-body font-medium">
            {phone ? (
              <SemanticValue kind="phone" copyable>
                {phone}
              </SemanticValue>
            ) : (
              "—"
            )}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-caption text-muted-foreground">
            {t("orderAmendments.detail.destination")}
          </dt>
          <dd className="text-body font-medium [overflow-wrap:anywhere]">
            {order.fulfillmentMethod === "PICKUP"
              ? t("storeOrders.fulfillmentMethod.PICKUP")
              : destination || "—"}
          </dd>
        </div>
      </dl>

      <div className="border-t border-border/70 px-1 pb-1">
        {order.items.length > 0 ? (
          <CompactDetailTable
            stacked
            columns={[
              {
                id: "product",
                header: t("storeOrders.detail.items.product"),
                cell: (item) => (
                  <span className="[overflow-wrap:anywhere]">
                    {item.product?.name ?? item.productId}
                  </span>
                ),
              },
              {
                id: "quantity",
                header: t("storeOrders.detail.items.quantity"),
                align: "end",
                cell: (item) => <SemanticValue kind="number">{item.quantity}</SemanticValue>,
              },
              {
                id: "total",
                header: t("storeOrders.fields.total"),
                align: "end",
                cell: (item) => <MoneyValue value={lineAmount(item)} currency={currency} />,
              },
            ]}
            rows={order.items}
            rowKey={(item) => item.id}
          />
        ) : (
          <p className="px-2 py-2 text-caption text-muted-foreground">{t("common.noResults")}</p>
        )}
      </div>

      <dl className="flex flex-col divide-y divide-border/60 border-t border-border/70 px-3 py-1 sm:ms-auto sm:max-w-sm">
        {breakdown ? (
          <>
            <Row label={t("orderAmendments.detail.merchandise")}>
              <MoneyValue value={breakdown.merchandise} currency={currency} />
            </Row>
            {breakdown.discount > 0 ? (
              <Row label={t("orderAmendments.detail.discount")}>
                <MoneyValue value={breakdown.discount} currency={currency} />
              </Row>
            ) : null}
            <Row
              label={
                <span className="inline-flex flex-wrap items-center gap-1.5">
                  {t("orderAmendments.detail.shipping")}
                  {stateKey ? (
                    <StatusBadge
                      label={t(stateKey)}
                      tone={order.shippingPricingStatus === "CONFIRMED" ? "success" : "warning"}
                    />
                  ) : null}
                </span>
              }
            >
              <MoneyValue value={breakdown.shipping} currency={currency} />
            </Row>
            {breakdown.service > 0 ? (
              <Row label={t("orderAmendments.detail.service")}>
                <MoneyValue value={breakdown.service} currency={currency} />
              </Row>
            ) : null}
          </>
        ) : null}
        <Row label={t("orderAmendments.detail.payable")} emphasis>
          <MoneyValue value={total} currency={currency} />
        </Row>
        {declared > 0 && declared !== paid ? (
          <Row label={t("orderAmendments.detail.declared")}>
            <MoneyValue value={declared} currency={currency} />
          </Row>
        ) : null}
        <Row label={t("orderAmendments.detail.paid")}>
          <MoneyValue value={paid} currency={currency} />
        </Row>
        <Row label={t("orderAmendments.detail.outstanding")}>
          <MoneyValue value={outstanding} currency={currency} />
        </Row>
      </dl>
    </section>
  );
}

/** Warning notice inside the compact card. */
export function OrderCardNotice({ children }: { children: ReactNode }) {
  return (
    <Alert tone="warning">
      <AlertTriangle />
      <AlertDescription className="flex flex-wrap items-center gap-2">{children}</AlertDescription>
    </Alert>
  );
}
