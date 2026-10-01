"use client";

import { useState } from "react";
import { CheckCircle2, Clock, Info } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { EnterpriseButton } from "@/components/ui/button";
import { ConfirmationDialog } from "@/components/shared/confirmation-dialog";
import { DetailField, DetailFieldGrid, DetailSection } from "@/components/shared/detail-workspace";
import { MoneyValue } from "@/components/shared/money-value";
import { StatusBadge } from "@/components/business/status-badge";
import { shippingPricingDisplay } from "@/config/agents/shipping-pricing";
import type { InternalShippingPricing, ShippingPricingView } from "@/services/agents-service";
import { useLocale } from "@/providers/locale-provider";
import { formatMoney } from "@/lib/money";
import { formatCurrencyAmounts } from "@/config/agents/commission-report";

type Currency = string | { code: string } | null | undefined;

const codeOf = (currency: Currency) =>
  typeof currency === "string" ? currency : (currency?.code ?? null);

/**
 * The "Provisional — final when Shipping selects the delivery method" notice
 * and the customer-total confirmation (spec-2-agent-pricing.md 2B). Shared
 * by the agent portal order detail and the internal order detail; renders
 * nothing when the order's shipping pricing is final and agreed.
 */
export function ShippingPricingNotice({
  pricing,
  currency,
  canConfirm,
  onConfirm,
}: {
  pricing: ShippingPricingView | null | undefined;
  currency: Currency;
  canConfirm: boolean;
  /** Records "Customer agreed to pay {total}"; the proposed total is echoed back. */
  onConfirm: (expectedPayableTotal: number) => Promise<void>;
}) {
  const { t } = useLocale();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);
  const display = shippingPricingDisplay(pricing ?? null);
  const change = pricing?.customerTotalChange ?? null;
  const money = (value: number) => formatMoney(value, codeOf(currency));

  if (
    !pricing ||
    (!display.provisional && !display.confirmationRequired && !display.showOutstanding)
  ) {
    return null;
  }

  const confirm = async () => {
    if (!change) return;
    setIsConfirming(true);
    try {
      await onConfirm(change.proposedPayableTotal);
      setConfirmOpen(false);
    } finally {
      setIsConfirming(false);
    }
  };

  return (
    <>
      {display.provisional ? (
        <Alert tone="info">
          <Clock />
          <AlertDescription>{t("agentPricing.provisionalNote")}</AlertDescription>
        </Alert>
      ) : null}
      {display.confirmationRequired && change ? (
        <Alert tone="warning">
          <Info />
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <AlertTitle>{t("agentPricing.customerTotal.requiredTitle")}</AlertTitle>
            <AlertDescription>
              {t("agentPricing.customerTotal.requiredDescription", {
                previous: money(change.previousPayableTotal),
                proposed: money(change.proposedPayableTotal),
              })}
            </AlertDescription>
            {canConfirm ? (
              <div>
                <EnterpriseButton
                  type="button"
                  size="sm"
                  variant="success"
                  onClick={() => setConfirmOpen(true)}
                >
                  <CheckCircle2 />
                  {t("agentPricing.customerTotal.confirm", {
                    total: money(change.proposedPayableTotal),
                  })}
                </EnterpriseButton>
              </div>
            ) : null}
          </div>
        </Alert>
      ) : null}
      {display.showOutstanding && pricing.payableTotal != null ? (
        <DetailFieldGrid columns={3}>
          <DetailField
            label={t("agentPricing.customerTotal.paid")}
            value={<MoneyValue value={pricing.paidAmount} currency={currency} />}
          />
          <DetailField
            label={t("agentPricing.customerTotal.newPayable")}
            value={<MoneyValue value={pricing.payableTotal} currency={currency} />}
          />
          <DetailField
            label={t("agentPricing.customerTotal.outstanding")}
            value={<MoneyValue value={pricing.outstanding ?? 0} currency={currency} />}
          />
        </DetailFieldGrid>
      ) : null}
      {change ? (
        <ConfirmationDialog
          open={confirmOpen}
          onOpenChange={setConfirmOpen}
          tone="success"
          title={t("agentPricing.customerTotal.confirmTitle")}
          description={t("agentPricing.customerTotal.confirmDescription", {
            total: money(change.proposedPayableTotal),
            shipping: money(change.proposedShippingCharge),
          })}
          confirmLabel={t("agentPricing.customerTotal.confirm", {
            total: money(change.proposedPayableTotal),
          })}
          isConfirming={isConfirming}
          onConfirm={() => void confirm()}
        />
      ) : null}
    </>
  );
}

/**
 * Internal order detail — the three shipping amounts kept apart (spec 2B):
 * customer shipping, the contractual agent shipping fee (with its delivery
 * method, provisional until chosen) and, internal only, the actual carrier
 * cost and the company shipping margin.
 */
export function InternalShippingPricingSection({
  pricing,
  currency,
}: {
  pricing: InternalShippingPricing;
  currency: Currency;
}) {
  const { t } = useLocale();
  const fee = pricing.agentShippingFee;
  const { economics } = pricing;
  const statusTone =
    pricing.status === "PENDING_METHOD"
      ? "warning"
      : pricing.status === "CONFIRMED"
        ? "success"
        : "neutral";
  const method = fee?.deliveryChannel
    ? [
        t(`agentPricing.tariffs.channels.${fee.deliveryChannel}`),
        fee.paymentType ? t(`agentPricing.tariffs.paymentTypes.${fee.paymentType}`) : null,
      ]
        .filter(Boolean)
        .join(" × ")
    : pricing.status === "PENDING_METHOD"
      ? t("agentPricing.panel.methodPending")
      : null;
  const carrier =
    economics.carrierCost.actualByCurrency.length > 0
      ? formatCurrencyAmounts(economics.carrierCost.actualByCurrency)
      : economics.carrierCost.estimate > 0
        ? t("agentPricing.panel.carrierEstimate", {
            amount: formatMoney(economics.carrierCost.estimate, codeOf(currency)),
          })
        : t("agentPricing.panel.carrierNone");

  return (
    <DetailSection
      title={t("agentPricing.panel.title")}
      actions={<StatusBadge label={t(`agentPricing.status.${pricing.status}`)} tone={statusTone} />}
    >
      <DetailFieldGrid columns={3}>
        <DetailField
          label={t("agentPricing.panel.customerShipping")}
          value={
            pricing.customerShipping != null ? (
              <MoneyValue value={pricing.customerShipping} currency={currency} />
            ) : null
          }
        />
        <DetailField
          label={
            fee?.provisional
              ? `${t("agentPricing.panel.agentFee")} (${t("agentPricing.shippingProvisional")})`
              : t("agentPricing.panel.agentFee")
          }
          value={fee ? <MoneyValue value={fee.amount} currency={currency} /> : null}
        />
        <DetailField label={t("agentPricing.panel.method")} value={method} />
        <DetailField label={t("agentPricing.panel.carrierCost")} value={carrier} />
        <DetailField
          label={
            economics.margin.basis
              ? `${t("agentPricing.panel.margin")} · ${t(`agentPricing.panel.marginBasis.${economics.margin.basis}`)}`
              : t("agentPricing.panel.margin")
          }
          value={
            economics.margin.amount != null ? (
              <MoneyValue value={economics.margin.amount} currency={currency} />
            ) : (
              t("agentPricing.panel.marginUnavailable")
            )
          }
        />
        {pricing.customerTotalStatus !== "NONE" ? (
          <DetailField
            label={t("agentPricing.customerTotal.label")}
            value={t(`agentPricing.customerTotal.status.${pricing.customerTotalStatus}`)}
          />
        ) : null}
      </DetailFieldGrid>
      <p className="text-caption text-muted-foreground">{t("agentPricing.panel.internalOnly")}</p>
    </DetailSection>
  );
}
