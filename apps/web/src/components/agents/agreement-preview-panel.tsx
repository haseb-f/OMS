"use client";

import { useEffect, useState } from "react";
import { DetailField, DetailFieldGrid } from "@/components/shared/detail-workspace";
import { ErrorState } from "@/components/shared/error-state";
import { MoneyValue } from "@/components/shared/money-value";
import { StatusBadge } from "@/components/business/status-badge";
import {
  CompactDetailTable,
  type CompactDetailColumn,
} from "@/components/shared/data-table/compact-detail-table";
import { agentsService, type AgreementPreview } from "@/services/agents-service";
import { useLocale } from "@/providers/locale-provider";
import { formatAmount } from "@/lib/money";
import { apiErrorMessage } from "@/lib/toast";

type PreviewItem = AgreementPreview["items"][number];

/**
 * What an agreement will apply, shown before Activate (commission-policy.md
 * A3): the worked example (commission per class + shipping reimbursement,
 * kept separate) and the rate each agent product will get.
 */
export function AgreementPreviewPanel({
  agentId,
  agreementId,
  onLoaded,
}: {
  agentId: string;
  agreementId: string;
  /** Lets the caller block activation while a product has no rate. */
  onLoaded?: (preview: AgreementPreview) => void;
}) {
  const { t } = useLocale();
  const [preview, setPreview] = useState<AgreementPreview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    agentsService.agreements
      .preview(agentId, agreementId)
      .then((result) => {
        if (!active) return;
        setPreview(result);
        onLoaded?.(result);
      })
      .catch((err: unknown) => active && setError(apiErrorMessage(err, "errors.generic")));
    return () => {
      active = false;
    };
  }, [agentId, agreementId, onLoaded]);

  if (error) return <ErrorState description={error} />;
  if (!preview) return null;
  const currency = preview.currency.code;
  const example = preview.example;
  const money = (value: number) => <MoneyValue value={value} currency={currency} />;

  const columns: CompactDetailColumn<PreviewItem>[] = [
    {
      id: "item",
      header: t("agents.commission.item"),
      cell: (row) => (
        <span>
          <span className="num">{row.sku}</span> — {row.name}
        </span>
      ),
    },
    {
      id: "class",
      header: t("agents.commission.class"),
      cell: (row) =>
        row.commissionClass ? (
          t(`agents.commission.classes.${row.commissionClass}`)
        ) : (
          <StatusBadge label={t("agents.commission.unclassified")} tone="warning" />
        ),
    },
    {
      id: "rate",
      header: t("agents.commission.rate"),
      align: "end",
      cell: (row) =>
        row.missing || row.ratePercent == null ? (
          <StatusBadge
            label={t(
              row.missing === "AGENT_ITEM_TYPE_REQUIRED"
                ? "agents.commission.itemTypeMissing"
                : "agents.commission.rateMissing",
            )}
            tone="destructive"
          />
        ) : (
          <span className="num">{formatAmount(row.ratePercent)}%</span>
        ),
    },
    {
      id: "source",
      header: t("agents.commission.source"),
      cell: (row) => (row.rateSource ? t(`agents.commission.sources.${row.rateSource}`) : "—"),
    },
  ];

  return (
    <div className="space-y-3 text-start">
      <p className="text-sm text-muted-foreground">{t("agents.commission.preview.intro")}</p>
      <DetailFieldGrid columns={2}>
        <DetailField
          label={t("agents.commission.preview.productCommission", {
            sales: formatAmount(example.productSales),
            rate: formatAmount(example.productRatePercent),
          })}
          value={money(example.productCommission)}
        />
        <DetailField
          label={t("agents.commission.preview.serviceCommission", {
            sales: formatAmount(example.serviceSales),
            rate: formatAmount(example.serviceRatePercent),
          })}
          value={money(example.serviceCommission)}
        />
        <DetailField
          label={t("agents.commission.preview.totalCommission")}
          value={money(example.totalCommission)}
        />
        <DetailField
          label={t("agents.commission.preview.customerShipping")}
          value={money(example.customerShipping)}
        />
        <DetailField
          label={t("agents.commission.preview.agentShippingCharge")}
          value={
            preview.shippingPolicy === "PREDETERMINED_CHARGE"
              ? t("agents.commission.preview.chargeSettled", {
                  charge: formatAmount(example.predeterminedShippingCharge),
                  applied: formatAmount(example.shippingAppliedToCharge),
                })
              : t(`agents.agreements.shippingPolicy.${preview.shippingPolicy}`)
          }
        />
        <DetailField
          label={t("agents.commission.preview.totalCollected")}
          value={money(example.totalCollected)}
        />
        <DetailField
          label={t("agents.commission.preview.companyRetains")}
          value={money(example.companyRetains)}
        />
        <DetailField
          label={t("agents.commission.preview.agentEntitlement")}
          value={money(example.agentEntitlement)}
        />
      </DetailFieldGrid>
      <p className="text-xs text-muted-foreground">{t("agents.commission.preview.assumption")}</p>
      {preview.items.length > 0 ? (
        <CompactDetailTable rows={preview.items} columns={columns} rowKey={(row) => row.id} />
      ) : (
        <p className="text-sm text-muted-foreground">{t("agents.commission.preview.noProducts")}</p>
      )}
    </div>
  );
}
