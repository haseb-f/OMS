"use client";

import { StatusBadge, type StatusTone } from "@/components/business/status-badge";
import { StatusStrip } from "@/components/shared/detail-workspace";
import {
  DECLARED_STATUS_TONE,
  declaredShortLabelKey,
} from "@/components/payments/declaration/declaration-status";
import {
  PAYMENT_STATUS_TONE,
  PAYMENT_TYPE_LABEL_KEY,
  SHIPPING_STAGE_LABEL_KEY,
  SHIPPING_STAGE_TONE,
  financialStatusLabelKey,
} from "@/config/store-orders/status";
import { catalogStatusTone } from "@/config/shipping/shipment-status";
import { useLocale } from "@/providers/locale-provider";
import type { StoreOrderRow } from "@/services/store-orders-service";

/** Tone for a fulfillment catalog status, by its stable code (the catalog has no color). */
export function fulfillmentStatusTone(code: string | null | undefined): StatusTone {
  if (!code) return "neutral";
  if (["DELIVERED", "COLLECTED", "COMPLETED", "FULFILLED"].includes(code)) return "success";
  if (["CANCELLED", "RETURNED", "DELIVERY_FAILED", "FAILED"].includes(code)) return "destructive";
  if (code.startsWith("AWAITING") || code === "NEW" || code === "PENDING") return "neutral";
  return "info";
}

/**
 * The store order's independent lifecycles, labeled and grouped: Payment
 * (what Sales declared vs what Finance verified) and Fulfillment (the
 * order's fulfillment state and its shipping state). Replaces a row of
 * unlabeled same-style badges.
 */
export function StoreOrderStatusStrip({ order }: { order: StoreOrderRow }) {
  const { t, locale } = useLocale();
  const fulfillment = order.fulfillmentStatus;
  const fulfillmentName = fulfillment
    ? locale === "en" && fulfillment.nameEn
      ? fulfillment.nameEn
      : fulfillment.name
    : null;
  const isPickup = order.fulfillmentMethod === "PICKUP";

  return (
    <StatusStrip
      label={t("docUi.statusStrip.label")}
      groups={[
        {
          key: "payment",
          label: t("docUi.statusStrip.paymentGroup"),
          items: [
            {
              key: "declared",
              label: t("docUi.statusStrip.declared"),
              status: (
                <StatusBadge
                  label={t(declaredShortLabelKey(order.declaredPaymentStatus))}
                  tone={DECLARED_STATUS_TONE[order.declaredPaymentStatus ?? "UNPAID"]}
                />
              ),
            },
            {
              key: "verified",
              label: t("docUi.statusStrip.verified"),
              status: (
                <StatusBadge
                  label={t(financialStatusLabelKey(order.paymentStatus, order.paymentType))}
                  tone={PAYMENT_STATUS_TONE[order.paymentStatus]}
                />
              ),
              caption: t(PAYMENT_TYPE_LABEL_KEY[order.paymentType ?? "PREPAID"]),
            },
          ],
        },
        {
          key: "fulfillment",
          label: t("docUi.statusStrip.fulfillmentGroup"),
          items: [
            ...(fulfillmentName
              ? [
                  {
                    key: "fulfillment",
                    label: t("docUi.statusStrip.fulfillment"),
                    status: (
                      <StatusBadge
                        label={fulfillmentName}
                        tone={fulfillmentStatusTone(fulfillment?.code)}
                      />
                    ),
                  },
                ]
              : []),
            ...(isPickup
              ? []
              : [
                  {
                    key: "shipping",
                    label: t("docUi.statusStrip.shipping"),
                    status: (
                      <StatusBadge
                        label={
                          order.shippingStatus?.name ??
                          t(SHIPPING_STAGE_LABEL_KEY[order.shippingStage])
                        }
                        tone={
                          order.shippingStatus
                            ? catalogStatusTone(order.shippingStatus.color)
                            : SHIPPING_STAGE_TONE[order.shippingStage]
                        }
                      />
                    ),
                  },
                ]),
          ],
        },
      ]}
    />
  );
}
