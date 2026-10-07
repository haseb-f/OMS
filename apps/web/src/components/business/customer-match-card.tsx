"use client";

import { RepeatCustomerBadge } from "@/components/business/repeat-customer-badge";
import { StatusBadge } from "@/components/business/status-badge";
import type { StatusTone } from "@/components/business/status-tone";
import { SemanticValue } from "@/components/shared/semantic-value";
import type { CustomerDisclosure, LookupOrderStatus } from "@/services/customer-lookup-service";
import { useLocale } from "@/providers/locale-provider";
import { formatDate } from "@/lib/date";

export const LOOKUP_STATUS_TONE: Record<LookupOrderStatus, StatusTone> = {
  IN_PROGRESS: "info",
  COMPLETED: "success",
  CANCELLED: "neutral",
  RETURNED: "warning",
};

/**
 * Round 14 — the one card that shows an existing customer to a
 * `customers.lookup_advanced` holder: full name and phone, the latest order
 * (number, date, products, coarse status) and the repeat-customer badge.
 * Shared by the advanced lookup and the order-entry duplicate panel. Shows
 * only what the server disclosed; it is never a link (opening a record still
 * needs the viewer's own scope).
 */
export function CustomerMatchCard({ disclosure }: { disclosure: CustomerDisclosure }) {
  const { t } = useLocale();
  const latest = disclosure.latestOrder;
  return (
    <div className="flex min-w-0 flex-col gap-1" data-testid="customer-match-card">
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <bdi className="min-w-0 font-medium [overflow-wrap:anywhere]">{disclosure.name}</bdi>
        {disclosure.phone ? (
          <SemanticValue kind="phone" className="text-muted-foreground">
            {disclosure.phone}
          </SemanticValue>
        ) : null}
        <RepeatCustomerBadge
          placedOrders={disclosure.placedOrders}
          completedPurchases={disclosure.completedPurchases}
        />
      </div>
      {latest ? (
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-caption">
          <span className="text-muted-foreground">{t("customerHistory.card.latestOrder")}:</span>
          <span dir="ltr" className="num font-medium">
            {latest.number}
          </span>
          <span className="text-muted-foreground">{formatDate(latest.orderDate)}</span>
          <StatusBadge
            tone={LOOKUP_STATUS_TONE[latest.status]}
            label={t(`customerLookup.status.${latest.status}`)}
          />
          {latest.productSummary ? (
            <bdi className="min-w-0 truncate text-muted-foreground">{latest.productSummary}</bdi>
          ) : null}
        </div>
      ) : (
        <span className="text-caption text-muted-foreground">
          {t("customerHistory.card.noOrders")}
        </span>
      )}
    </div>
  );
}
