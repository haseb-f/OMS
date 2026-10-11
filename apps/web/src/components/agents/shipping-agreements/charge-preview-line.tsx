"use client";

import { useLocale } from "@/providers/locale-provider";
import { formatAmount } from "@/lib/money";
import { ltrIsolate } from "@/lib/bidi";
import type { AgentShippingRateService } from "@/services/agents-service";
import { chargePreview } from "./shipping-terms-form";

/**
 * Live preview of one shipping rate (R17 §3): «مدفوع مسبقًا: 25 — الدفع عند
 * الاستلام: 25 + 10 = 35» (or «شامل رسوم التحصيل» on an all-inclusive row).
 * Prepaid never pays the fee. Nothing is shown until the amount is valid.
 */
export function ChargePreviewLine({
  service,
  amount,
  fee,
  includesCodFee,
  currency,
}: {
  service: AgentShippingRateService;
  amount: string;
  fee: string;
  includesCodFee: boolean;
  currency: string;
}) {
  const { t } = useLocale();
  const preview = chargePreview(service, amount, fee, includesCodFee);
  if (!preview) return null;
  const money = (value: number) => ltrIsolate(formatAmount(value));
  const withCurrency = (value: number) => ltrIsolate(`${formatAmount(value)} ${currency}`);
  const parts: string[] = [];
  if (preview.prepaid != null) {
    parts.push(
      t("agentShippingAgreements.preview.prepaid", { amount: withCurrency(preview.prepaid) }),
    );
  }
  if (preview.cod != null) {
    parts.push(
      preview.included
        ? t("agentShippingAgreements.preview.codIncluded", { total: withCurrency(preview.cod) })
        : preview.fee > 0
          ? t("agentShippingAgreements.preview.codAdded", {
              base: money(preview.base),
              fee: money(preview.fee),
              total: withCurrency(preview.cod),
            })
          : t("agentShippingAgreements.preview.cod", { total: withCurrency(preview.cod) }),
    );
  }
  return (
    <p
      className="text-caption text-muted-foreground"
      aria-live="polite"
      data-testid="charge-preview"
    >
      {parts.join(" — ")}
    </p>
  );
}
