"use client";

import {
  CheckCircle2,
  CircleDashed,
  PackageCheck,
  Truck,
  Undo2,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { StatusBadge } from "@/components/business/status-badge";
import { FinanceStatusBadge, DeclaredStatusBadge } from "@/components/agent-portal/portal-badges";
import { fulfillmentCodeLabelKey } from "@/config/agent-portal/labels";
import { RecordGridCard, type RowAction } from "@/components/shared/data-table";
import { LocaleText } from "@/components/shared/locale-text";
import { MoneyValue } from "@/components/shared/money-value";
import { SemanticValue } from "@/components/shared/semantic-value";
import { customerPhone, latestShipment } from "@/components/store-orders/store-order-row-cells";
import { storeOrderFulfillmentCode } from "@/components/store-orders/store-order-workflow-tracks";
import {
  fulfillmentStatusTone,
  orderFulfillmentBadge,
  orderPaymentBadge,
} from "@/config/store-orders/order-status-badges";
import {
  ORDER_WORKFLOW_STATE_TONE,
  orderWorkflowState,
  type OrderWorkflowState,
} from "@/config/store-orders/order-workflow-state";
import {
  companyOrderNextAction,
  portalOrderNextAction,
  type CompanyOrderPermissions,
} from "@/config/store-orders/order-list-next-action";
import { NEXT_ACTION_ICON } from "@/config/store-orders/next-action-icons";
import { formatDate } from "@/lib/date";
import { useLocale } from "@/providers/locale-provider";
import type { NextAction } from "@/config/store-orders/next-action";
import type { StoreOrderRow } from "@/services/store-orders-service";
import type { PortalOrderRow } from "@/services/agent-portal-service";
import type { MessageKey } from "@/i18n/translate";

/** Each lifecycle state also carries an icon, so it reads without the colour. */
const STATE_ICON: Record<OrderWorkflowState, LucideIcon> = {
  pending: CircleDashed,
  readyToShip: PackageCheck,
  shipped: Truck,
  delivered: CheckCircle2,
  returned: Undo2,
  cancelled: XCircle,
};

interface OrderCardCommon {
  selected: boolean;
  onToggleSelected: () => void;
  href: string;
  actions?: RowAction[];
}

function nextActionProp(next: NextAction, t: (key: MessageKey) => string) {
  if (!next.labelKey || next.kind === "NONE") return null;
  return { label: t(next.labelKey), icon: NEXT_ACTION_ICON[next.kind] };
}

/**
 * The company order card of the Grid view. Colour = fulfilment lifecycle
 * (ready to ship / shipped / delivered / returned / cancelled). Payment and
 * fulfilment stay two separate badges, as in the table.
 */
export function StoreOrderGridCard({
  order,
  permissions,
  ...common
}: OrderCardCommon & { order: StoreOrderRow; permissions: CompanyOrderPermissions }) {
  const { t, locale } = useLocale();
  const state = orderWorkflowState({
    fulfillmentCode: storeOrderFulfillmentCode(order),
    shipmentStatus: latestShipment(order)?.status ?? null,
    shippingStage: order.shippingStage,
  });
  const payment = orderPaymentBadge(order);
  const fulfillment = orderFulfillmentBadge({
    fulfillmentMethod: order.fulfillmentMethod,
    fulfillmentStatus: order.fulfillmentStatus,
    latestShipmentStatus: latestShipment(order)?.status ?? null,
    locale,
  });
  const phone = customerPhone(order);
  const name = order.partner?.name ?? order.internalOrderId;

  return (
    <RecordGridCard
      {...common}
      tone={ORDER_WORKFLOW_STATE_TONE[state]}
      selectLabel={t("tableViews.card.selectRow", { name })}
      title={<LocaleText>{name}</LocaleText>}
      subtitle={phone ? <SemanticValue kind="phone">{phone}</SemanticValue> : null}
      reference={
        <SemanticValue kind="id" className="font-medium">
          {order.internalOrderId}
        </SemanticValue>
      }
      meta={
        <span className="inline-flex items-baseline gap-2">
          <SemanticValue kind="date">{formatDate(order.orderDate)}</SemanticValue>
          <MoneyValue
            value={order.total ?? "0"}
            currency={order.currency}
            className="text-foreground"
          />
        </span>
      }
      badges={
        <>
          <StatusBadge
            label={payment.labelKey ? t(payment.labelKey) : (payment.label ?? "")}
            tone={payment.tone}
          />
          <StatusBadge
            label={fulfillment.labelKey ? t(fulfillment.labelKey) : (fulfillment.label ?? "")}
            tone={fulfillment.tone}
            icon={STATE_ICON[state]}
          />
        </>
      }
      nextAction={nextActionProp(companyOrderNextAction(order, permissions), t)}
      nextActionLabel={t("tableViews.card.nextAction")}
      actionsLabel={t("tableViews.card.actions")}
    />
  );
}

/** The agent-portal order card - same card; the agent's own read-only fields. */
export function PortalOrderGridCard({
  order,
  canDeclarePayment,
  ...common
}: OrderCardCommon & { order: PortalOrderRow; canDeclarePayment: boolean }) {
  const { t, locale } = useLocale();
  const code = order.fulfillmentStatus?.code ?? null;
  const state = orderWorkflowState({ fulfillmentCode: code });
  const fulfillmentKey = fulfillmentCodeLabelKey(code);
  const fulfillmentLabel = order.fulfillmentStatus
    ? fulfillmentKey
      ? t(fulfillmentKey)
      : locale === "en" && order.fulfillmentStatus.nameEn
        ? order.fulfillmentStatus.nameEn
        : order.fulfillmentStatus.name
    : t("storeOrders.shippingStage.NOT_READY");
  const name = order.customer?.name ?? order.internalOrderId;

  return (
    <RecordGridCard
      {...common}
      tone={ORDER_WORKFLOW_STATE_TONE[state]}
      selectLabel={t("tableViews.card.selectRow", { name })}
      title={<LocaleText>{name}</LocaleText>}
      subtitle={
        order.customer?.mobile ? (
          <SemanticValue kind="phone">{order.customer.mobile}</SemanticValue>
        ) : null
      }
      reference={
        <SemanticValue kind="id" className="font-medium">
          {order.internalOrderId}
        </SemanticValue>
      }
      meta={
        <span className="inline-flex items-baseline gap-2">
          <SemanticValue kind="date">{formatDate(order.orderDate)}</SemanticValue>
          <MoneyValue
            value={order.breakdown.payableTotal}
            currency={order.currency}
            className="text-foreground"
          />
        </span>
      }
      badges={
        <>
          <FinanceStatusBadge status={order.financePaymentStatus} />
          {order.declaredPaymentStatus !== "UNPAID" ? (
            <DeclaredStatusBadge status={order.declaredPaymentStatus} />
          ) : null}
          <StatusBadge
            label={fulfillmentLabel}
            tone={fulfillmentStatusTone(code)}
            icon={STATE_ICON[state]}
          />
        </>
      }
      nextAction={nextActionProp(
        portalOrderNextAction(order, { declarePayment: canDeclarePayment }),
        t,
      )}
      nextActionLabel={t("tableViews.card.nextAction")}
      actionsLabel={t("tableViews.card.actions")}
    />
  );
}
