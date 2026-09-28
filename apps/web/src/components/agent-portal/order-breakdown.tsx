"use client";

import { CreateOperationTotals } from "@/components/shared/create-operation";
import { MoneyValue } from "@/components/shared/money-value";
import { useLocale } from "@/providers/locale-provider";
import type { ShippingChargeSource } from "@/services/agent-portal-service";

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
}: {
  figures: BreakdownFigures;
  currency?: string | { code: string } | null;
  shippingSource?: ShippingChargeSource | null;
  /** The configured rate — shown next to a manual override so the difference is visible. */
  shippingRate?: number | null;
  rateScope?: "CITY" | "COUNTRY" | null;
}) {
  const { t } = useLocale();
  const money = (value: number | null) =>
    value == null ? "—" : <MoneyValue value={value} currency={currency} />;

  const sourceNote =
    shippingSource === "RATE"
      ? `${t("agentPortal.orderForm.breakdown.configuredRate")}${
          rateScope
            ? ` · ${t(
                rateScope === "CITY"
                  ? "agentPortal.orderForm.breakdown.rateScopeCity"
                  : "agentPortal.orderForm.breakdown.rateScopeCountry",
              )}`
            : ""
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
      value: money(figures.payableTotal),
      emphasis: "strong" as const,
    },
  ];

  return <CreateOperationTotals rows={rows} />;
}
