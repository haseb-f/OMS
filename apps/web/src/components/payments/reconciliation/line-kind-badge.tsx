"use client";

import { StatusBadge } from "@/components/business/status-badge";
import { useLocale } from "@/providers/locale-provider";
import type { StatementLineKind } from "@/services/payment-reconciliation-service";

/** R13 D2 — marks a refund / chargeback statement line (never matched, reviewed instead); nothing for a payment. */
export function StatementLineKindBadge({
  kind,
  review = false,
}: {
  kind?: StatementLineKind | null;
  /** Show the full "Refund / chargeback — review" status instead of the short kind label. */
  review?: boolean;
}) {
  const { t } = useLocale();
  if (!kind || kind === "PAYMENT") return null;
  return (
    <StatusBadge
      label={
        review ? t("paymentReconciliation.kind.review") : t(`paymentReconciliation.kind.${kind}`)
      }
      tone="warning"
    />
  );
}
