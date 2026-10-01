"use client";

import { StatusBadge } from "@/components/business/status-badge";
import type { MessageKey } from "@/i18n/translate";
import { formatDateTime } from "@/lib/date";
import { useLocale } from "@/providers/locale-provider";
import type { AmendmentHistoryRow } from "@/services/order-amendments-service";

const FIELD_KEYS: Record<string, MessageKey> = {
  currency: "orderAmendments.detail.amendments.fields.currency",
  paymentType: "orderAmendments.detail.amendments.fields.paymentType",
  fulfillmentMethod: "orderAmendments.detail.amendments.fields.fulfillmentMethod",
  pricingMode: "orderAmendments.detail.amendments.fields.pricingMode",
  destination: "orderAmendments.detail.amendments.fields.destination",
  customer: "orderAmendments.detail.amendments.fields.customer",
  total: "orderAmendments.detail.amendments.fields.total",
};

/** A field diff value as one line of text (objects: their non-empty values). */
function valueText(value: unknown): string {
  if (value == null || value === "") return "—";
  if (typeof value === "object") {
    const parts = Object.entries(value as Record<string, unknown>)
      .filter(([key, v]) => key !== "partnerId" && key !== "countryId" && v != null && v !== "")
      .map(([, v]) => String(v));
    return parts.length ? parts.join(" · ") : "—";
  }
  return String(value);
}

/**
 * Round 5 Spec 1A — the append-only amendment history of an order: version,
 * who / when, reason and the field and line changes. Shared by the internal
 * order detail and the agent portal (the API never sends the internal
 * snapshot to agents).
 */
export function OrderAmendmentHistory({ rows }: { rows: AmendmentHistoryRow[] | null }) {
  const { t } = useLocale();
  if (rows === null) {
    return <p className="text-caption text-muted-foreground">{t("common.loading")}</p>;
  }
  if (rows.length === 0) {
    return (
      <p className="text-caption text-muted-foreground">
        {t("orderAmendments.detail.amendments.empty")}
      </p>
    );
  }
  return (
    <ol className="flex flex-col divide-y divide-border/60" data-testid="amendment-history">
      {rows.map((row) => (
        <li key={row.id} className="flex min-w-0 flex-col gap-1 py-2">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge
              label={t("orderAmendments.detail.amendments.version", { version: row.version })}
              tone="info"
            />
            <span className="text-caption text-muted-foreground">
              {t("orderAmendments.detail.amendments.by", {
                actor:
                  row.actorName ??
                  (row.actorType === "AGENT" ? t("orderAmendments.detail.amendments.agent") : "—"),
                date: formatDateTime(row.createdAt),
              })}
            </span>
          </div>
          <p className="text-body [overflow-wrap:anywhere]">{row.reason}</p>
          <ul className="flex flex-col gap-0.5 text-caption text-muted-foreground">
            {Object.entries(row.changes?.fields ?? {}).map(([field, change]) => (
              <li key={field} className="[overflow-wrap:anywhere]">
                {t("orderAmendments.detail.amendments.field", {
                  field: FIELD_KEYS[field] ? t(FIELD_KEYS[field]) : field,
                  old: valueText(change.old),
                  new: valueText(change.new),
                })}
              </li>
            ))}
            {(row.changes?.lines ?? []).map((line, index) => (
              <li key={`${line.productId}-${index}`} className="[overflow-wrap:anywhere]">
                {line.kind === "ADDED" && line.new
                  ? t("orderAmendments.detail.amendments.lineAdded", {
                      product: line.product ?? line.productId,
                      quantity: line.new.quantity,
                      amount: line.new.agreedAmount,
                    })
                  : line.kind === "REMOVED" && line.old
                    ? t("orderAmendments.detail.amendments.lineRemoved", {
                        product: line.product ?? line.productId,
                        quantity: line.old.quantity,
                      })
                    : line.old && line.new
                      ? t("orderAmendments.detail.amendments.lineChanged", {
                          product: line.product ?? line.productId,
                          oldQuantity: line.old.quantity,
                          oldAmount: line.old.agreedAmount,
                          newQuantity: line.new.quantity,
                          newAmount: line.new.agreedAmount,
                        })
                      : null}
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ol>
  );
}
