"use client";

import { DetailField, DetailFieldGrid } from "@/components/shared/detail-workspace";
import { MoneyValue } from "@/components/shared/money-value";
import { useLocale } from "@/providers/locale-provider";
import { formatAmount } from "@/lib/money";
import { formatDate } from "@/lib/date";
import type { AgentAgreement } from "@/services/agents-service";

/** Read-only presentation of every agreement term (ACTIVE / ENDED agreements and the Overview). */
export function AgreementTerms({ agreement }: { agreement: AgentAgreement }) {
  const { t } = useLocale();
  const currency = agreement.currency?.code ?? null;
  return (
    <DetailFieldGrid columns={3}>
      <DetailField
        label={t("agents.agreements.period")}
        value={`${formatDate(agreement.effectiveFrom)} – ${
          agreement.effectiveTo
            ? formatDate(agreement.effectiveTo)
            : t("agents.agreements.openEnded")
        }`}
      />
      <DetailField
        label={t("agents.agreements.fields.productRate")}
        value={
          <span className="num">
            {formatAmount(Number(agreement.productCommissionRatePercent))}%
          </span>
        }
      />
      <DetailField
        label={t("agents.agreements.fields.serviceRate")}
        value={
          <span className="num">
            {formatAmount(Number(agreement.serviceCommissionRatePercent))}%
          </span>
        }
      />
      <DetailField
        label={t("agents.agreements.fields.shippingPolicy")}
        value={t(`agents.agreements.shippingPolicy.${agreement.shippingPolicy}`)}
      />
      <DetailField
        label={t("agents.agreements.fields.earningEvent")}
        value={t(`agents.agreements.earningEvent.${agreement.commissionEarningEvent}`)}
      />
      <DetailField
        label={t("agents.agreements.fields.returnTreatment")}
        value={t(`agents.agreements.returnTreatment.${agreement.returnCommissionTreatment}`)}
      />
      <DetailField
        label={t("agents.agreements.fields.shippingChargeOwner")}
        value={t(`agents.agreements.owner.${agreement.customerShippingChargeOwner}`)}
      />
      <DetailField
        label={t("agents.agreements.fields.providerFeesBorneBy")}
        value={t(`agents.agreements.owner.${agreement.providerFeesBorneBy}`)}
      />
      {/* Fees are shown even when 0 — every term is explicit. */}
      <DetailField
        label={t("agents.agreements.fields.shippingFee")}
        value={<MoneyValue value={agreement.shippingFeePerShipment} currency={currency} />}
      />
      <DetailField
        label={t("agents.agreements.fields.returnFee")}
        value={<MoneyValue value={agreement.returnFeePerShipment} currency={currency} />}
      />
      <DetailField
        label={t("agents.agreements.fields.serviceFee")}
        value={<MoneyValue value={agreement.serviceFeePerOrder} currency={currency} />}
      />
      <DetailField
        label={t("agents.agreements.fields.allowAgentDestinations")}
        value={
          agreement.allowAgentDestinations ? t("agents.agreements.yes") : t("agents.agreements.no")
        }
      />
      <DetailField
        label={t("agents.agreements.fields.payoutHoldDays")}
        value={<span className="num">{agreement.payoutHoldDays}</span>}
      />
      <DetailField label={t("agents.agreements.fields.notes")} value={agreement.notes} />
    </DetailFieldGrid>
  );
}
