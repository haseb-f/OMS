"use client";

import { StatusBadge, type StatusTone } from "@/components/business/status-badge";
import { useLocale } from "@/providers/locale-provider";
import type { MessageKey } from "@/i18n/translate";
import type { StoreOrderStockStatus } from "./stock-api";

/** Meaning, not decoration: green = done, amber = needs attention, red = cannot ship, blue = moving. */
export const STOCK_STATUS_TONE: Record<StoreOrderStockStatus, StatusTone> = {
  PENDING: "neutral",
  NOT_REQUIRED: "neutral",
  RESERVED: "info",
  SHORT: "destructive",
  IN_TRANSIT: "info",
  PARTIALLY_DELIVERED: "warning",
  DELIVERED: "success",
  RETURNING: "warning",
  RETURNED: "neutral",
  RELEASED: "neutral",
};

/**
 * R15 W5a — the order's physical stock state, the one chip the Store Orders
 * list and the order header both use (shared `StatusBadge`).
 */
export function StockStatusChip({
  status,
  className,
}: {
  status: StoreOrderStockStatus | null | undefined;
  className?: string;
}) {
  const { t } = useLocale();
  if (!status) return null;
  return (
    <StatusBadge
      label={t(`storeOrderStock.status.${status}` as MessageKey)}
      tone={STOCK_STATUS_TONE[status]}
      className={className}
    />
  );
}
