"use client";

import type { ReactNode } from "react";
import { PaymentClaimBadge } from "@/components/payments/payment-term-badge";
import { RecordGridCard } from "@/components/shared/data-table";
import { LocaleText } from "@/components/shared/locale-text";
import { RelatedRecordLink } from "@/components/shared/record-preview";
import { SemanticValue } from "@/components/shared/semantic-value";
import { claimTerm, paymentTerm } from "@/config/payments/payment-vocabulary";
import { formatDate } from "@/lib/date";
import { formatMoney } from "@/lib/money";
import { useLocale } from "@/providers/locale-provider";
import type { PaymentReviewRow } from "@/services/payments-review-service";

/**
 * The payment-review card of the Grid view (R9): customer, payment number,
 * date and amount as the key figure, the order, what remains to settle, the
 * payment method and the proof count - the fields the Payment Review table
 * shows - plus the SAME state badge. The row's primary action, Reject and menu
 * are the table's own actions control, passed in (`actions`) so permissions,
 * block reasons and busy state are identical in both views; they sit in the
 * footer where a button strip fits. Colour = the claim's workflow state (from
 * the one payment vocabulary). The card has no stretched link: the review
 * panel opens through the actions, as in the table.
 */
export function PaymentReviewGridCard({
  payment,
  selected,
  onToggleSelected,
  actions,
}: {
  payment: PaymentReviewRow;
  selected: boolean;
  /** Omitted when the user cannot select (no confirm permission) - no checkbox is drawn. */
  onToggleSelected?: () => void;
  /** The table's Actions cell content. */
  actions: ReactNode;
}) {
  const { t } = useLocale();
  const customer =
    payment.storeOrder?.partner?.name ?? payment.lead?.customerName ?? payment.senderName;
  const term = claimTerm({ status: payment.status, settlementStatus: payment.settlementStatus });
  const tone = term ? paymentTerm(term).tone : "neutral";
  const method = payment.paymentMethod?.name ?? payment.paymentSource?.name ?? "—";
  return (
    <RecordGridCard
      tone={tone}
      selected={selected}
      onToggleSelected={onToggleSelected}
      selectLabel={t("tableViews.card.selectRow", { name: payment.paymentNumber })}
      title={<LocaleText>{customer}</LocaleText>}
      reference={
        <RelatedRecordLink
          kind="PAYMENT"
          id={payment.id}
          number={payment.paymentNumber}
          status={payment.status}
          variant="inline"
        />
      }
      meta={
        <span className="inline-flex items-baseline gap-2">
          <SemanticValue kind="date">{formatDate(payment.paymentDate)}</SemanticValue>
          <SemanticValue kind="money" className="font-medium text-foreground">
            {formatMoney(payment.amount, payment.currency?.code)}
          </SemanticValue>
        </span>
      }
      fields={[
        {
          key: "order",
          label: t("finance.paymentReview.fields.order"),
          value: payment.storeOrder ? (
            <RelatedRecordLink
              kind="STORE_ORDER"
              id={payment.storeOrder.id}
              number={payment.storeOrder.internalOrderId}
              variant="inline"
            />
          ) : (
            (payment.lead?.leadNumber ?? "—")
          ),
        },
        {
          key: "remaining",
          label: t("finance.paymentReview.fields.remaining"),
          value: (
            <SemanticValue kind="money">
              {payment.settlement ? formatMoney(payment.settlement.outstanding) : "—"}
            </SemanticValue>
          ),
          numeric: true,
        },
        {
          key: "method",
          label: t("paymentDeclaration.review.method"),
          value: <LocaleText>{method}</LocaleText>,
        },
        {
          key: "proof",
          label: t("finance.paymentReview.fields.proof"),
          value: <SemanticValue kind="number">{String(payment.attachments.length)}</SemanticValue>,
          numeric: true,
        },
      ]}
      badges={
        <PaymentClaimBadge status={payment.status} settlementStatus={payment.settlementStatus} />
      }
      footer={actions}
    />
  );
}
