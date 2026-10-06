"use client";

import { DetailSection } from "@/components/shared/detail-workspace";
import { CompactDetailTable } from "@/components/shared/data-table/compact-detail-table";
import { MoneyValue } from "@/components/shared/money-value";
import {
  frozenExchangeRate,
  hasPostedSplit,
  postedSplitTotals,
} from "@/config/purchasing/landed-cost-split";
import { formatNumber } from "@/lib/format-number";
import { useLocale } from "@/providers/locale-provider";
import type {
  LandedCostAllocationRow,
  LandedCostDocumentRow,
} from "@/services/landed-cost-service";

/**
 * R13 — a posted landed cost's frozen exchange rate and, per allocation, how
 * much was capitalized into inventory (units still on hand) vs charged to COGS
 * (units already sold). Renders nothing until the document carries either.
 */
export function LandedCostPostedAllocation({
  document,
  currencyCode,
}: {
  document: LandedCostDocumentRow;
  currencyCode: string | null;
}) {
  const { t } = useLocale();
  const rate = frozenExchangeRate(document);
  const showSplit = hasPostedSplit(document.allocations);
  if (rate === null && !showSplit) return null;

  const totals = postedSplitTotals(document.allocations);
  const money = (value: string | number | null | undefined) =>
    value === null || value === undefined ? (
      "—"
    ) : (
      <MoneyValue value={value} currency={currencyCode} />
    );

  return (
    <DetailSection title={t("purchasing.landedCost.posted.title")}>
      {rate !== null ? (
        <p className="text-caption text-muted-foreground">
          {t("purchasing.landedCost.posted.exchangeRate")}:{" "}
          <span dir="ltr" className="num font-medium text-foreground">
            {formatNumber(rate, { maxDecimals: 8 })}
          </span>
        </p>
      ) : null}
      {showSplit ? (
        <>
          <CompactDetailTable<LandedCostAllocationRow>
            stacked
            rows={document.allocations}
            rowKey={(allocation) => allocation.id}
            columns={[
              {
                id: "product",
                header: t("purchasing.landedCost.allocationPreview.product"),
                cell: (allocation) =>
                  allocation.purchaseInvoiceItem?.product?.name ?? allocation.purchaseInvoiceItemId,
                footer: t("purchasing.landedCost.allocationPreview.total"),
              },
              {
                id: "quantity",
                header: t("purchasing.landedCost.posted.allocatedQuantity"),
                align: "end",
                cell: (allocation) => (
                  <span dir="ltr" className="num">
                    {formatNumber(allocation.allocatedQuantity)}
                  </span>
                ),
              },
              {
                id: "allocated",
                header: t("purchasing.landedCost.posted.allocatedAmount"),
                align: "end",
                cell: (allocation) => money(allocation.allocatedAmount),
                footer: money(totals.allocated),
              },
              {
                id: "capitalized",
                header: t("purchasing.landedCost.posted.capitalized"),
                align: "end",
                cell: (allocation) => money(allocation.capitalizedAmount),
                footer: money(totals.capitalized),
              },
              {
                id: "variance",
                header: t("purchasing.landedCost.posted.variance"),
                align: "end",
                cell: (allocation) => money(allocation.cogsVarianceAmount),
                footer: money(totals.variance),
              },
            ]}
          />
          <p className="text-caption text-muted-foreground">
            {t("purchasing.landedCost.posted.explanation")}
          </p>
        </>
      ) : null}
    </DetailSection>
  );
}
