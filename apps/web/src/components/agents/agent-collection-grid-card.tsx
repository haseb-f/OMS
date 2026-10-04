"use client";

import type { ReactNode } from "react";
import { StatusBadge, type StatusTone } from "@/components/business/status-badge";
import { RecordGridCard } from "@/components/shared/data-table";
import { LocaleText } from "@/components/shared/locale-text";
import { MoneyValue } from "@/components/shared/money-value";
import { SemanticValue } from "@/components/shared/semantic-value";
import { formatDate } from "@/lib/date";
import { useLocale } from "@/providers/locale-provider";
import type { AgentCollectionRow } from "@/services/agents-service";

/**
 * The agent-collection card of the Grid view (R9) - company side, where
 * finance reviews a payment a customer made directly to an agent. Shows the
 * fields the table shows: agent, payment number and date, the amount, order
 * and customer, destination, status (with the rejection reason or reviewer).
 * Review controls sit in the footer, next to the evidence they depend on:
 * `evidence` and `actions` are the table's OWN cells (same permission gate),
 * passed in so the card never re-implements them. There is no detail route,
 * so the card has no stretched link. Colour = review status.
 */
export function AgentCollectionGridCard({
  collection,
  selected,
  onToggleSelected,
  statusLabel,
  statusTone,
  evidence,
  actions,
}: {
  collection: AgentCollectionRow;
  selected: boolean;
  onToggleSelected: () => void;
  statusLabel: string;
  statusTone: StatusTone;
  /** The table's Evidence cell. */
  evidence: ReactNode;
  /** The table's Actions cell (Verify / Reject), or null when not permitted / not reviewable. */
  actions: ReactNode;
}) {
  const { t } = useLocale();
  const agentName = collection.agent?.name ?? "—";
  const order = collection.storeOrder;
  const destination = collection.agentPaymentDestination;
  const reviewNote =
    collection.rejectionReason ??
    collection.verifiedBy?.fullName ??
    collection.rejectedBy?.fullName ??
    null;
  return (
    <RecordGridCard
      tone={statusTone}
      selected={selected}
      onToggleSelected={onToggleSelected}
      selectLabel={t("tableViews.card.selectRow", { name: collection.paymentNumber })}
      title={<LocaleText>{agentName}</LocaleText>}
      subtitle={
        collection.agent ? (
          <SemanticValue kind="id">{collection.agent.agentNumber}</SemanticValue>
        ) : null
      }
      reference={
        <SemanticValue kind="id" className="font-medium">
          {collection.paymentNumber}
        </SemanticValue>
      }
      meta={
        <span className="inline-flex items-baseline gap-2">
          <SemanticValue kind="date">{formatDate(collection.paymentDate)}</SemanticValue>
          <MoneyValue
            value={collection.amount}
            currency={collection.currency}
            className="text-foreground"
          />
        </span>
      }
      fields={[
        ...(order
          ? [
              {
                key: "order",
                label: t("agents.collections.order"),
                value: <SemanticValue kind="id">{order.internalOrderId}</SemanticValue>,
              },
              ...(order.partner?.name
                ? [
                    {
                      key: "customer",
                      label: t("agents.collections.customer"),
                      value: <LocaleText>{order.partner.name}</LocaleText>,
                    },
                  ]
                : []),
            ]
          : []),
        ...(destination
          ? [
              {
                key: "destination",
                label: t("agents.collections.destination"),
                value: <LocaleText>{destination.label}</LocaleText>,
              },
            ]
          : []),
        ...(collection.paymentMethod
          ? [
              {
                key: "method",
                label: t("masterData.expenses.fields.paymentMethod"),
                value: <LocaleText>{collection.paymentMethod.name}</LocaleText>,
              },
            ]
          : []),
      ]}
      badges={<StatusBadge label={statusLabel} tone={statusTone} />}
      footer={
        <div className="flex min-w-0 flex-col gap-2">
          {reviewNote ? (
            <span className="min-w-0 truncate" title={reviewNote}>
              {reviewNote}
            </span>
          ) : null}
          <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
            {evidence}
            {actions}
          </div>
        </div>
      }
    />
  );
}
