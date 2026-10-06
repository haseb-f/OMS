"use client";

import { useMemo } from "react";
import { DetailSection } from "@/components/shared/detail-workspace";
import { CompactDetailTable } from "@/components/shared/data-table/compact-detail-table";
import { SemanticValue } from "@/components/shared/semantic-value";
import { canViewInventoryCost } from "@/config/inventory/cost-visibility";
import { kitComponentRows, kitLines, type KitComponentRow } from "@/config/sales/kit-fulfillment";
import { useProductNames } from "@/hooks/use-product-names";
import { formatAmount } from "@/lib/money";
import { formatNumber } from "@/lib/format-number";
import { useLocale } from "@/providers/locale-provider";
import { useUserContext } from "@/providers/user-context";
import type { SalesInvoiceItemRow } from "@/services/sales-invoices-service";

/**
 * R13 — the components a sales invoice's KIT lines delivered (from each line's
 * `fulfillmentSnapshot`): name, quantity per kit, quantity delivered and, only
 * for a caller who may see inventory cost, the snapshot unit cost. Renders
 * nothing when the invoice has no kit line.
 */
export function KitComponentsSection({ items }: { items: readonly SalesInvoiceItemRow[] }) {
  const { t } = useLocale();
  const { hasPermission } = useUserContext();
  const showCost = canViewInventoryCost(hasPermission);
  const lines = useMemo(() => kitLines(items), [items]);
  const names = useProductNames(
    lines.flatMap((line) => line.fulfillmentSnapshot.components.map((c) => c.productId)),
  );

  if (lines.length === 0) return null;

  return (
    <DetailSection title={t("sales.invoices.kit.title")}>
      <p className="text-caption text-muted-foreground">{t("sales.invoices.kit.note")}</p>
      {lines.map((line) => {
        const rows = kitComponentRows(line.fulfillmentSnapshot, line.quantity, showCost);
        const withCost = rows.some((row) => row.unitCost !== null);
        const kitName = line.product?.displayName || line.product?.name || line.description || "";
        return (
          <div key={line.id} className="flex flex-col gap-1">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="text-body font-medium">
                {t("sales.invoices.kit.line", {
                  product: kitName,
                  quantity: formatNumber(line.quantity),
                })}
              </span>
              <span className="text-caption text-muted-foreground">
                {t("sales.invoices.kit.recipeVersion", {
                  version: line.fulfillmentSnapshot.version,
                })}
              </span>
            </div>
            <CompactDetailTable<KitComponentRow>
              stacked
              rows={rows}
              rowKey={(row) => row.productId}
              columns={[
                {
                  id: "component",
                  header: t("sales.invoices.kit.component"),
                  cell: (row) => {
                    const entry = names.get(row.productId);
                    return entry ? (
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate">{entry.name}</span>
                        <SemanticValue kind="id" className="text-caption text-muted-foreground">
                          {entry.sku}
                        </SemanticValue>
                      </span>
                    ) : (
                      <span className="text-muted-foreground">
                        {t("sales.invoices.kit.unknownComponent")}
                      </span>
                    );
                  },
                },
                {
                  id: "perKit",
                  header: t("sales.invoices.kit.perKit"),
                  align: "end",
                  cell: (row) => (
                    <span dir="ltr" className="num">
                      {formatNumber(row.perKit)}
                    </span>
                  ),
                },
                {
                  id: "delivered",
                  header: t("sales.invoices.kit.delivered"),
                  align: "end",
                  cell: (row) => (
                    <span dir="ltr" className="num font-medium">
                      {formatNumber(row.delivered)}
                    </span>
                  ),
                },
                ...(withCost
                  ? [
                      {
                        id: "unitCost",
                        header: t("sales.invoices.kit.unitCost"),
                        align: "end" as const,
                        cell: (row: KitComponentRow) =>
                          row.unitCost === null ? (
                            "—"
                          ) : (
                            <span dir="ltr" className="num">
                              {formatAmount(row.unitCost, { decimals: 4 })}
                            </span>
                          ),
                      },
                    ]
                  : []),
              ]}
            />
          </div>
        );
      })}
    </DetailSection>
  );
}
