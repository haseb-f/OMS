"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { DetailGroup, DetailFieldRow, DetailSection } from "@/components/shared/detail-workspace";
import { StatusBadge } from "@/components/business/status-badge";
import { EnterpriseButton } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  storeOrdersService,
  type OrderEconomics,
  type CostState,
} from "@/services/store-orders-service";
import { useLocale } from "@/providers/locale-provider";
import { ApiError } from "@/services/api-client";
import { toast } from "@/lib/toast";
import type { MessageKey } from "@/i18n/translate";

function formatMoney(value: number | null) {
  if (value === null) return "—";
  return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatPercent(value: number | null) {
  if (value === null) return "—";
  return `${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
}

const COST_STATE_TONE: Record<CostState, "success" | "warning" | "neutral"> = {
  COMPLETE: "success",
  PARTIAL: "warning",
  UNKNOWN: "neutral",
};

function CostStateBadge({ state }: { state: CostState }) {
  const { t } = useLocale();
  return (
    <StatusBadge
      label={t(`storeOrders.profitability.costStateValues.${state}` as MessageKey)}
      tone={COST_STATE_TONE[state]}
    />
  );
}

/**
 * ADR-0018 — pure display of `OrderEconomicsService`'s already-computed,
 * already-tested output. Never recalculates Revenue/COGS/Shipping/
 * Contribution itself — that would be exactly the "frontend must not
 * calculate financial profitability independently" rule the ADR exists to
 * prevent. `costState` is always shown next to a figure, never just the
 * number alone, since PARTIAL/UNKNOWN must never read as a final actual.
 */
export function OrderProfitabilityPanel({ storeOrderId }: { storeOrderId: string }) {
  const { t } = useLocale();
  const router = useRouter();
  const [economics, setEconomics] = useState<OrderEconomics | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    storeOrdersService
      .getEconomics(storeOrderId)
      .then((result) => {
        if (cancelled) return;
        setEconomics(result);
        setError(null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const message = err instanceof ApiError ? err.message : "Failed to load Order Economics.";
        setError(message);
        if (!(err instanceof ApiError && err.code === "PERMISSION_ERROR")) {
          toast.error(message);
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [storeOrderId]);

  if (isLoading) {
    return <p className="text-caption text-muted-foreground">{t("common.loading")}</p>;
  }
  if (error || !economics) {
    return <p className="text-caption text-muted-foreground">{error ?? t("common.noResults")}</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex justify-end">
        <EnterpriseButton
          type="button"
          variant="ghost"
          size="sm"
          onClick={() =>
            router.push(`/expenses/cost-explorer?mode=order&storeOrderId=${storeOrderId}`)
          }
        >
          {t("storeOrders.profitability.viewInCostExplorer")}
        </EnterpriseButton>
      </div>
      <DetailGroup title={t("storeOrders.profitability.grossProfit")}>
        <DetailFieldRow
          label={t("storeOrders.profitability.netRevenue")}
          value={formatMoney(economics.netRevenue)}
        />
        <DetailFieldRow
          label={t("storeOrders.profitability.cogs")}
          value={
            <span className="inline-flex items-center gap-1.5">
              {formatMoney(economics.cogs)}
              <CostStateBadge state={economics.cogsState} />
            </span>
          }
        />
        <DetailFieldRow
          label={t("storeOrders.profitability.grossProductProfit")}
          value={formatMoney(economics.grossProductProfit)}
        />
        <DetailFieldRow
          label={t("storeOrders.profitability.grossMargin")}
          value={formatPercent(economics.grossMarginPercent)}
        />
      </DetailGroup>

      <DetailGroup title={t("storeOrders.profitability.directCosts")}>
        <DetailFieldRow
          label={t("storeOrders.profitability.shipping")}
          value={
            <span className="inline-flex items-center gap-1.5">
              {formatMoney(economics.shippingCost)}
              <CostStateBadge state={economics.shippingState} />
            </span>
          }
        />
        <DetailFieldRow
          label={t("storeOrders.profitability.fulfillmentCost")}
          value={
            <span className="inline-flex items-center gap-1.5">
              {formatMoney(economics.fulfillmentCost)}
              <CostStateBadge state={economics.fulfillmentCostState} />
              {economics.fulfillmentCostRuleName ? (
                <span className="text-caption text-muted-foreground">
                  ({economics.fulfillmentCostRuleName})
                </span>
              ) : null}
            </span>
          }
        />
        <DetailFieldRow
          label={t("storeOrders.profitability.paymentFee")}
          value={
            <span className="inline-flex items-center gap-1.5">
              {formatMoney(economics.paymentFeeCost)}
              <CostStateBadge state={economics.paymentFeeState} />
            </span>
          }
        />
      </DetailGroup>

      <DetailGroup title={t("storeOrders.profitability.contributionProfit")}>
        <DetailFieldRow
          label={t("storeOrders.profitability.contributionProfit")}
          value={formatMoney(economics.contributionProfit)}
        />
        <DetailFieldRow
          label={t("storeOrders.profitability.contributionMargin")}
          value={formatPercent(economics.contributionMarginPercent)}
        />
        <DetailFieldRow
          label={t("storeOrders.profitability.costState")}
          value={<CostStateBadge state={economics.costState} />}
        />
      </DetailGroup>

      {economics.shippingAttempts.length > 0 && (
        <DetailSection title={t("storeOrders.profitability.shippingAttempts")}>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("storeOrders.profitability.attempt")}</TableHead>
                <TableHead>{t("shipping.fields.status")}</TableHead>
                <TableHead>{t("storeOrders.profitability.cost")}</TableHead>
                <TableHead>{t("costExplorer.order.costSource")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {economics.shippingAttempts.map((attempt) => (
                <TableRow key={attempt.shipmentId}>
                  <TableCell>#{attempt.attemptNumber}</TableCell>
                  <TableCell>{attempt.status ?? "—"}</TableCell>
                  <TableCell>{formatMoney(attempt.totalCost)}</TableCell>
                  <TableCell>
                    {t(`costExplorer.order.costSourceValues.${attempt.costSource}` as MessageKey)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </DetailSection>
      )}

      {economics.payments.length > 0 && (
        <DetailSection title={t("storeOrders.profitability.paymentFees")}>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("storeOrders.profitability.amount")}</TableHead>
                <TableHead>{t("storeOrders.profitability.fee")}</TableHead>
                <TableHead>{t("storeOrders.profitability.feeSource")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {economics.payments.map((payment) => (
                <TableRow key={payment.paymentId}>
                  <TableCell>{formatMoney(payment.amount)}</TableCell>
                  <TableCell>{formatMoney(payment.feeAmount)}</TableCell>
                  <TableCell>
                    {t(
                      `storeOrders.profitability.feeSourceValues.${payment.feeSource}` as MessageKey,
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </DetailSection>
      )}

      {economics.items.length > 0 && (
        <DetailSection title={t("storeOrders.profitability.itemBreakdown")}>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("storeOrders.profitability.quantity")}</TableHead>
                <TableHead>{t("storeOrders.profitability.netRevenue")}</TableHead>
                <TableHead>{t("storeOrders.profitability.unitCost")}</TableHead>
                <TableHead>{t("storeOrders.profitability.cogs")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {economics.items.map((item, index) => (
                <TableRow key={`${item.productId}-${index}`}>
                  <TableCell>{item.quantity}</TableCell>
                  <TableCell>{formatMoney(item.netRevenue)}</TableCell>
                  <TableCell>{formatMoney(item.historicalUnitCost)}</TableCell>
                  <TableCell>{formatMoney(item.cogs)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </DetailSection>
      )}
    </div>
  );
}
