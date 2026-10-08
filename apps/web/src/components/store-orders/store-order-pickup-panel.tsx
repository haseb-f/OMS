"use client";

import { useState } from "react";
import { DetailFieldRow, DetailGroup } from "@/components/shared/detail-workspace";
import { StatusBadge } from "@/components/business/status-badge";
import { ConfirmationDialog } from "@/components/shared/confirmation-dialog";
import { EnterpriseButton } from "@/components/ui/button";
import { storeOrdersService, type PickupTransitionCode } from "@/services/store-orders-service";
import { useLocale } from "@/providers/locale-provider";
import { toast, reportApiError } from "@/lib/toast";
import type { MessageKey } from "@/i18n/translate";
import type { StatusTone } from "@/components/business/status-badge";

const PICKUP_STATUS_CODES = [
  "AWAITING_PREPARATION",
  "READY_FOR_PICKUP",
  "COLLECTED",
  "CANCELLED",
  "RETURNED",
] as const;
type PickupStatusCode = (typeof PICKUP_STATUS_CODES)[number];

const TONE: Record<PickupStatusCode, StatusTone> = {
  AWAITING_PREPARATION: "neutral",
  READY_FOR_PICKUP: "info",
  COLLECTED: "success",
  CANCELLED: "destructive",
  RETURNED: "warning",
};

/** Same transition table the API enforces (`transitionPickup`). */
const NEXT: Record<PickupStatusCode, PickupTransitionCode[]> = {
  AWAITING_PREPARATION: ["READY_FOR_PICKUP", "CANCELLED"],
  READY_FOR_PICKUP: ["COLLECTED", "CANCELLED"],
  COLLECTED: [],
  CANCELLED: [],
  RETURNED: [],
};

const NEEDS_CONFIRMATION = new Set<PickupTransitionCode>(["COLLECTED", "CANCELLED"]);

function asPickupCode(code: string | null | undefined): PickupStatusCode {
  return (PICKUP_STATUS_CODES as readonly string[]).includes(code ?? "")
    ? (code as PickupStatusCode)
    : "AWAITING_PREPARATION";
}

/**
 * Pickup workflow on the order page — no labels, no carrier queue, nothing
 * automatic. Payment never gates a physical step (R15 D15-3): a prepaid order
 * is prepared and handed over like a COD one; its money is tracked separately.
 */
export function StoreOrderPickupPanel({
  orderId,
  fulfillmentStatusCode,
  canTransition,
  onChanged,
}: {
  orderId: string;
  fulfillmentStatusCode?: string | null;
  canTransition: boolean;
  onChanged: () => void;
}) {
  const { t } = useLocale();
  const [pending, setPending] = useState<PickupTransitionCode | null>(null);
  const [confirming, setConfirming] = useState<PickupTransitionCode | null>(null);
  const current = asPickupCode(fulfillmentStatusCode);
  const actions = NEXT[current];

  const run = async (code: PickupTransitionCode) => {
    setPending(code);
    try {
      await storeOrdersService.transitionPickup(orderId, code);
      toast.success(t("paymentDeclaration.pickup.success"));
      setConfirming(null);
      onChanged();
    } catch (error) {
      reportApiError(error, "paymentDeclaration.pickup.failed");
    } finally {
      setPending(null);
    }
  };

  return (
    <DetailGroup title={t("paymentDeclaration.pickup.title")}>
      <DetailFieldRow
        label={t("paymentDeclaration.pickup.status")}
        value={
          <StatusBadge
            label={t(`paymentDeclaration.pickup.codes.${current}` as MessageKey)}
            tone={TONE[current]}
          />
        }
      />
      {canTransition && actions.length > 0 ? (
        <div className="flex flex-wrap gap-2 py-1.5">
          {actions.map((code) => (
            <EnterpriseButton
              key={code}
              type="button"
              size="xs"
              variant={code === "CANCELLED" ? "outline" : "default"}
              disabled={pending != null}
              onClick={() => (NEEDS_CONFIRMATION.has(code) ? setConfirming(code) : void run(code))}
            >
              {t(`paymentDeclaration.pickup.actions.${code}` as MessageKey)}
            </EnterpriseButton>
          ))}
        </div>
      ) : null}
      <ConfirmationDialog
        open={confirming != null}
        onOpenChange={(open) => {
          if (!open) setConfirming(null);
        }}
        tone={confirming === "CANCELLED" ? "destructive" : undefined}
        title={
          confirming ? t(`paymentDeclaration.pickup.confirm.${confirming}.title` as MessageKey) : ""
        }
        description={
          confirming
            ? t(`paymentDeclaration.pickup.confirm.${confirming}.description` as MessageKey)
            : undefined
        }
        confirmLabel={
          confirming ? t(`paymentDeclaration.pickup.actions.${confirming}` as MessageKey) : ""
        }
        cancelLabel={t("common.cancel")}
        isConfirming={pending != null}
        onConfirm={() => {
          if (confirming) void run(confirming);
        }}
      />
    </DetailGroup>
  );
}
