"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, Truck } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { EnterpriseButton } from "@/components/ui/button";
import { useLocale } from "@/providers/locale-provider";
import { useUserContext } from "@/providers/user-context";
import type { MessageKey } from "@/i18n/translate";
import {
  shippingQueueHref,
  shippingService,
  type ShippingHandoff,
  type ShippingHandoffBlocker,
} from "@/services/shipping-service";

/** Blockers worth explaining on a shipping order (pickup / archived speak for themselves). */
const EXPLAINED_BLOCKERS = new Set<ShippingHandoffBlocker>([
  "PAYMENT_REQUIRED",
  "NOT_SHIPPABLE",
  "ORDER_CANCELLED",
]);

export function shippingBlockerKey(blocker: ShippingHandoffBlocker): MessageKey {
  return `shippingHandoff.blocker.${blocker}` as MessageKey;
}

/**
 * One-line feedback after an order is created or converted: "Sent to
 * Shipping" or why not. Null when it does not apply or cannot be read.
 */
export async function fetchShippingHandoffFeedback(
  storeOrderId: string,
  t: (key: MessageKey) => string,
): Promise<string | undefined> {
  try {
    const handoff = await shippingService.handoff(storeOrderId);
    if (!handoff.applicable) return undefined;
    if (handoff.queued) return t("shippingHandoff.sentToShipping");
    return handoff.blocker ? t(shippingBlockerKey(handoff.blocker)) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Server handoff state of one order, re-read whenever `refreshKey` changes
 * (an empty key = the order is not loaded yet, nothing is fetched).
 */
export function useShippingHandoff(storeOrderId: string, refreshKey: string) {
  const [handoff, setHandoff] = useState<ShippingHandoff | null>(null);
  useEffect(() => {
    if (!refreshKey) return;
    let active = true;
    shippingService
      .handoff(storeOrderId)
      .then((value) => {
        if (active) setHandoff(value);
      })
      .catch(() => {
        if (active) setHandoff(null);
      });
    return () => {
      active = false;
    };
  }, [storeOrderId, refreshKey]);
  return handoff;
}

/**
 * R6 SHIP — Store Order detail: why a shipping order is not in the Shipping
 * queue, or (for `shipping.view` users) a link to it in the queue.
 */
export function ShippingHandoffNotice({
  handoff,
  internalOrderId,
  awaitingShipping,
}: {
  handoff: ShippingHandoff | null;
  internalOrderId: string;
  /** The current attempt has no carrier status yet (Ready for shipping). */
  awaitingShipping: boolean;
}) {
  const { t } = useLocale();
  const { hasPermission } = useUserContext();
  if (!handoff?.applicable) return null;
  if (handoff.queued) {
    if (!awaitingShipping || !hasPermission("shipping.view")) return null;
    return (
      <Alert tone="info" data-testid="shipping-handoff-queued">
        <Truck />
        <AlertDescription className="flex flex-wrap items-center gap-2">
          <span>{t("shippingHandoff.inQueue")}</span>
          <EnterpriseButton asChild size="sm" variant="outline">
            <Link href={shippingQueueHref(internalOrderId)}>
              {t("shippingHandoff.openInQueue")}
            </Link>
          </EnterpriseButton>
        </AlertDescription>
      </Alert>
    );
  }
  if (!handoff.blocker || !EXPLAINED_BLOCKERS.has(handoff.blocker)) return null;
  return (
    <Alert tone="warning" data-testid="shipping-handoff-blocker">
      <AlertTriangle />
      <AlertDescription>{t(shippingBlockerKey(handoff.blocker))}</AlertDescription>
    </Alert>
  );
}
