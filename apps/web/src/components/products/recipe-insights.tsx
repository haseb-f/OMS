"use client";

import { useEffect, useState } from "react";
import { EnterpriseBadge } from "@/components/ui/badge";
import { DetailFieldRow } from "@/components/shared/detail-workspace";
import { MoneyValue } from "@/components/shared/money-value";
import { useLocale } from "@/providers/locale-provider";
import {
  productsService,
  type KitAvailability,
  type RecipeCostEstimate,
} from "@/services/products-service";
import { formatNumber } from "@/lib/format-number";

/**
 * Read-only recipe cost ESTIMATE (`recipe-cost-estimate`): components' current
 * cost x quantity plus the recipe's direct-cost estimate. Always labelled as an
 * estimate; the actual cost is fixed by the assembly order. Renders nothing
 * when the API returns no cost (no active recipe, or no cost-visibility right).
 */
export function RecipeCostEstimateCard({
  productId,
  refreshKey,
  showDirectCost,
}: {
  productId: string;
  /** Bump to reload after the active recipe changed. */
  refreshKey: string;
  /** A Kit has no direct cost. */
  showDirectCost: boolean;
}) {
  const { t } = useLocale();
  const [estimate, setEstimate] = useState<RecipeCostEstimate | null>(null);

  useEffect(() => {
    let cancelled = false;
    productsService
      .recipeCostEstimate(productId)
      .then((result) => !cancelled && setEstimate(result))
      // No active recipe / not visible to this user: the estimate is simply not shown.
      .catch(() => !cancelled && setEstimate(null));
    return () => {
      cancelled = true;
    };
  }, [productId, refreshKey]);

  if (!estimate || (estimate.totalEstimate == null && estimate.componentsEstimate == null)) {
    return null;
  }
  const money = (value: string | null | undefined) =>
    value == null ? undefined : <MoneyValue value={value} />;

  return (
    <div className="flex flex-col gap-1 rounded-sm border border-border bg-surface-sunken px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="text-body font-semibold">{t("products.recipe.estimate.title")}</h4>
        <EnterpriseBadge variant="warning">{t("products.recipe.estimate.badge")}</EnterpriseBadge>
        <span className="text-caption text-muted-foreground">
          {t("products.recipe.versionLabel", { version: estimate.version })}
        </span>
      </div>
      <dl className="flex flex-col">
        <DetailFieldRow
          label={t("products.recipe.estimate.components")}
          value={money(estimate.componentsEstimate)}
        />
        {showDirectCost && (
          <DetailFieldRow
            label={t("products.recipe.estimate.direct")}
            value={money(estimate.directCostEstimate)}
          />
        )}
        <DetailFieldRow
          label={t("products.recipe.estimate.total")}
          value={money(estimate.totalEstimate)}
        />
        <DetailFieldRow
          label={t("products.recipe.estimate.perUnit")}
          value={money(estimate.perUnitEstimate)}
        />
      </dl>
      <p className="text-caption text-muted-foreground">{t("products.recipe.estimate.note")}</p>
    </div>
  );
}

/** Kit availability (`kit-availability`): how many kits the components allow now, and which component limits it. */
export function KitAvailabilityCard({
  productId,
  refreshKey,
}: {
  productId: string;
  refreshKey: string;
}) {
  const { t } = useLocale();
  const [availability, setAvailability] = useState<KitAvailability | null>(null);

  useEffect(() => {
    let cancelled = false;
    productsService
      .kitAvailability(productId)
      .then((result) => !cancelled && setAvailability(result))
      .catch(() => !cancelled && setAvailability(null));
    return () => {
      cancelled = true;
    };
  }, [productId, refreshKey]);

  if (!availability) return null;
  const { limiting } = availability;

  return (
    <div className="flex flex-col gap-1 rounded-sm border border-border bg-surface-sunken px-3 py-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h4 className="text-body font-semibold">{t("products.recipe.availability.title")}</h4>
        <span className="text-body">
          {t("products.recipe.availability.available")}{" "}
          <strong dir="ltr" className="num">
            {formatNumber(availability.available)}
          </strong>
        </span>
      </div>
      {limiting ? (
        <p
          className={
            availability.available === 0
              ? "text-caption text-warning-soft-foreground"
              : "text-caption text-muted-foreground"
          }
        >
          {t("products.recipe.availability.limitedBy", {
            name: limiting.name,
            perKit: formatNumber(limiting.perKit),
            available: formatNumber(limiting.available),
          })}
        </p>
      ) : null}
    </div>
  );
}
