"use client";

import { CreateOperationTotals } from "@/components/shared/create-operation";
import { MoneyValue } from "@/components/shared/money-value";
import { useLocale } from "@/providers/locale-provider";
import type { ShippingChargeSource, ShippingRateScope } from "@/services/agent-portal-service";
import type { MessageKey } from "@/i18n/translate";
import { formatMoney } from "@/lib/money";

const codeOf = (currency: string | { code: string } | null | undefined) =>
  typeof currency === "string" ? currency : (currency?.code ?? null);

/** Which agreement row priced the shipping (city, country, or the all-destinations row). */
const RATE_SCOPE_LABEL: Record<ShippingRateScope, MessageKey> = {
  CITY: "agentPortal.orderForm.breakdown.rateScopeCity",
  COUNTRY: "agentPortal.orderForm.breakdown.rateScopeCountry",
  ALL: "agentShippingAgreements.allDestinations",
};

export interface BreakdownFigures {
  merchandiseAmount: number | null;
  discountAmount: number | null;
  taxAmount: number | null;
  shippingCharge: number | null;
  serviceCharge: number | null;
  payableTotal: number;
}

/**
 * The agent order price breakdown — merchandise, discount, tax, shipping
 * (with where the shipping figure came from), service charge and the
 * payable total. Used live on the new-order form (from the quote) and on
 * the order detail (stored breakdown). Figures are the server's; a legacy
 * order without a breakdown shows its payable total only.
 */
export function OrderBreakdown({
  figures,
  currency,
  shippingSource,
  shippingRate,
  rateScope,
  provisional = false,
  mode,
}: {
  figures: BreakdownFigures;
  currency?: string | { code: string } | null;
  shippingSource?: ShippingChargeSource | null;
  /** The configured rate — shown next to a manual override so the difference is visible. */
  shippingRate?: number | null;
  rateScope?: ShippingRateScope | null;
  /** Spec 2 — the shipping fee is an estimate until Shipping selects the delivery method. */
  provisional?: boolean;
  mode?: "SHIPPING_ADDED" | "SHIPPING_INCLUDED" | null;
}) {
  const { t } = useLocale();
  const money = (value: number | null) =>
    value == null ? "—" : <MoneyValue value={value} currency={currency} />;

  // Shipping added + provisional: the total is never shown as final.
  const payablePending = provisional && mode !== "SHIPPING_INCLUDED";
  const sourceNote = provisional
    ? t("agentPricing.shippingProvisional")
    : shippingSource === "RATE"
      ? `${t("agentPortal.orderForm.breakdown.configuredRate")}${
          rateScope ? ` · ${t(RATE_SCOPE_LABEL[rateScope])}` : ""
        }`
      : shippingSource === "MANUAL"
        ? t("agentPortal.orderForm.breakdown.manualOverride")
        : shippingSource === "NONE"
          ? t("agentPortal.orderForm.breakdown.noShipping")
          : null;

  const rows = [
    {
      label: t("agentPortal.orderForm.breakdown.merchandise"),
      value: money(figures.merchandiseAmount),
    },
    ...((figures.discountAmount ?? 0) > 0
      ? [
          {
            label: t("agentPortal.orderForm.breakdown.discount"),
            value: money(figures.discountAmount),
          },
        ]
      : []),
    { label: t("agentPortal.orderForm.breakdown.tax"), value: money(figures.taxAmount) },
    {
      label: sourceNote
        ? `${t("agentPortal.orderForm.breakdown.shipping")} (${sourceNote})`
        : t("agentPortal.orderForm.breakdown.shipping"),
      value:
        shippingSource === "MANUAL" && shippingRate != null ? (
          <span className="flex items-baseline gap-1.5">
            <span className="text-micro text-muted-foreground line-through">
              <MoneyValue value={shippingRate} currency={currency} />
            </span>
            {money(figures.shippingCharge)}
          </span>
        ) : (
          money(figures.shippingCharge)
        ),
    },
    ...((figures.serviceCharge ?? 0) > 0
      ? [
          {
            label: t("agentPortal.orderForm.breakdown.serviceCharge"),
            value: money(figures.serviceCharge),
          },
        ]
      : []),
    {
      label: t("agentPortal.orderForm.breakdown.payable"),
      value: payablePending ? (
        <span className="flex flex-col items-end">
          <span>
            {t("agentPricing.payablePending", {
              merchandise: formatMoney(figures.merchandiseAmount ?? 0, codeOf(currency)),
            })}
          </span>
          <span className="text-micro font-normal text-muted-foreground">
            {t("agentPricing.payableEstimate", {
              amount: formatMoney(figures.payableTotal, codeOf(currency)),
            })}
          </span>
        </span>
      ) : (
        money(figures.payableTotal)
      ),
      emphasis: "strong" as const,
    },
  ];

  return (
    <div className="flex flex-col gap-1.5">
      <CreateOperationTotals rows={rows} />
      {provisional ? (
        <p className="text-caption text-muted-foreground">{t("agentPricing.provisionalNote")}</p>
      ) : null}
    </div>
  );
}
