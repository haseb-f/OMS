"use client";

import { useEffect, useState } from "react";
import { Repeat } from "lucide-react";
import { StatusBadge } from "@/components/business/status-badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  customerHistoryService,
  type CustomerOrderStats,
} from "@/services/customer-history-service";
import { useLocale } from "@/providers/locale-provider";

/** Same threshold as the API (`customer-order-stats.ts`): two placed orders. */
export const REPEAT_CUSTOMER_MIN_ORDERS = 2;

/**
 * Round 14 — "عميل متكرر · N طلبات" (N = placed orders, company-wide), with the
 * completed purchases in the tooltip. Renders nothing below two placed orders.
 * The one badge for the customer header, the store-order header, the lookup
 * card and the duplicate panel.
 */
export function RepeatCustomerBadge({ placedOrders, completedPurchases }: CustomerOrderStats) {
  const { t } = useLocale();
  if (placedOrders < REPEAT_CUSTOMER_MIN_ORDERS) return null;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex" data-testid="repeat-customer-badge" tabIndex={0}>
          <StatusBadge
            tone="info"
            icon={Repeat}
            label={t("customerHistory.repeat.label", { count: placedOrders })}
          />
        </span>
      </TooltipTrigger>
      <TooltipContent>
        {t("customerHistory.repeat.tooltip", { count: completedPurchases })}
      </TooltipContent>
    </Tooltip>
  );
}

/** The badge for a page that only knows the customer id (e.g. a store order header). */
export function PartnerRepeatBadge({ partnerId }: { partnerId: string | null | undefined }) {
  const [stats, setStats] = useState<CustomerOrderStats | null>(null);
  useEffect(() => {
    if (!partnerId) return;
    let active = true;
    customerHistoryService
      .orderStats(partnerId)
      .then((next) => {
        if (active) setStats(next);
      })
      // Informational only: no badge when the numbers are not available to the viewer.
      .catch(() => {
        if (active) setStats(null);
      });
    return () => {
      active = false;
    };
  }, [partnerId]);
  return stats ? <RepeatCustomerBadge {...stats} /> : null;
}
