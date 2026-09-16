"use client";

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { PageWorkspace } from "@/components/shared/page-workspace";
import { ProductPicker } from "@/components/business/product-picker";
import { productsService } from "@/services/products-service";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { DetailSummaryBar, DetailField } from "@/components/shared/detail-workspace";
import { inventoryService, type StockCard } from "@/services/inventory-service";
import { productCostService, type ProductCostHistoryEntry } from "@/services/product-cost-service";
import type { ProductRow } from "@/services/products-service";
import { useLocale } from "@/providers/locale-provider";
import { toast } from "@/lib/toast";
import { formatDateTime } from "@/lib/date";
import { ApiError } from "@/services/api-client";
import { PermissionGate } from "@/components/shared/permission-gate";
import type { MessageKey } from "@/i18n/translate";

function formatMoney(value: number | string | null) {
  if (value === null) return "—";
  return Number(value).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function sourceLabel(t: (key: MessageKey) => string, referenceType: string | null) {
  if (!referenceType) return "—";
  const key = `costExplorer.source.${referenceType}` as MessageKey;
  const label = t(key);
  return label === key ? referenceType : label;
}

function CostExplorerPageContent() {
  const { t } = useLocale();
  const searchParams = useSearchParams();
  const [product, setProduct] = useState<ProductRow | null>(null);
  const [stockCard, setStockCard] = useState<StockCard | null>(null);
  const [history, setHistory] = useState<ProductCostHistoryEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const load = useCallback((productId: string) => {
    setIsLoading(true);
    Promise.all([
      inventoryService.getStockCard(productId),
      productCostService.getCostHistory(productId),
    ])
      .then(([stockCardResult, historyResult]) => {
        setStockCard(stockCardResult);
        setHistory(historyResult);
      })
      .catch((error) => {
        setStockCard(null);
        setHistory([]);
        toast.error(error instanceof ApiError ? error.message : "Failed to load cost history.");
      })
      .finally(() => setIsLoading(false));
  }, []);

  const handleProductChange = (next: ProductRow) => {
    setProduct(next);
    load(next.id);
  };

  useEffect(() => {
    const deepLinkId = searchParams.get("productId");
    if (!deepLinkId) return;
    productsService
      .get(deepLinkId)
      .then((row) => handleProductChange(row))
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  return (
    <PageWorkspace title={t("costExplorer.title")} description={t("costExplorer.description")}>
      <div className="max-w-sm">
        <ProductPicker
          value={product}
          onChange={handleProductChange}
          inventoryOnly
          sellableOnly={false}
        />
      </div>

      {!product ? (
        <p className="text-caption text-muted-foreground">{t("costExplorer.empty")}</p>
      ) : (
        <>
          <DetailSummaryBar>
            <DetailField
              label={t("costExplorer.currentCost")}
              value={formatMoney(stockCard?.averageCost ?? null)}
            />
            <DetailField label={t("costExplorer.onHand")} value={stockCard?.onHand ?? "—"} />
            <DetailField
              label={t("costExplorer.stockValue")}
              value={formatMoney(stockCard?.stockValue ?? null)}
            />
          </DetailSummaryBar>

          {isLoading ? (
            <p className="text-caption text-muted-foreground">{t("common.loading")}</p>
          ) : history.length === 0 ? (
            <p className="text-caption text-muted-foreground">{t("costExplorer.emptyHistory")}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("costExplorer.fields.date")}</TableHead>
                  <TableHead>{t("costExplorer.fields.previousCost")}</TableHead>
                  <TableHead>{t("costExplorer.fields.newCost")}</TableHead>
                  <TableHead>{t("costExplorer.fields.delta")}</TableHead>
                  <TableHead>{t("costExplorer.fields.source")}</TableHead>
                  <TableHead>{t("costExplorer.fields.reason")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {history.map((entry) => {
                  const previous = entry.previousCost === null ? null : Number(entry.previousCost);
                  const next = Number(entry.newCost);
                  const delta = previous === null ? null : next - previous;
                  return (
                    <TableRow key={entry.id}>
                      <TableCell>{formatDateTime(entry.createdAt)}</TableCell>
                      <TableCell>{formatMoney(previous)}</TableCell>
                      <TableCell>{formatMoney(next)}</TableCell>
                      <TableCell
                        className={
                          delta === null
                            ? undefined
                            : delta > 0
                              ? "text-destructive"
                              : delta < 0
                                ? "text-success"
                                : undefined
                        }
                      >
                        {delta === null ? "—" : `${delta > 0 ? "+" : ""}${formatMoney(delta)}`}
                      </TableCell>
                      <TableCell>{sourceLabel(t, entry.referenceType)}</TableCell>
                      <TableCell>{entry.reason ?? "—"}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </>
      )}
    </PageWorkspace>
  );
}

export default function ExpensesCostExplorerPage() {
  return (
    <PermissionGate permission="cost-explorer.view">
      <CostExplorerPageContent />
    </PermissionGate>
  );
}
