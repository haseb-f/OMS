"use client";

import { StatusBadge } from "@/components/business/status-badge";
import { useLocale } from "@/providers/locale-provider";
import type { MessageKey } from "@/i18n/translate";

/**
 * R15 (D15-4) — marks the system warehouses whose stock is owned but never
 * available to sell: goods in transit (with the carrier) and damaged goods.
 * Renders nothing for an ordinary STOCK warehouse.
 */
export function WarehouseRoleBadge({ role }: { role: string | null | undefined }) {
  const { t } = useLocale();
  if (!role || role === "STOCK") return null;
  return (
    <StatusBadge
      label={t(`storeOrderStock.warehouseRole.${role}` as MessageKey)}
      tone={role === "DAMAGED" ? "warning" : "info"}
    />
  );
}
