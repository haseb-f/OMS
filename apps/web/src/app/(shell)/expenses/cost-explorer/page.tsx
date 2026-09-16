"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { PageWorkspace } from "@/components/shared/page-workspace";
import { ProductPicker } from "@/components/business/product-picker";
import { productsService } from "@/services/products-service";
import { EntityTabs } from "@/components/business/entity-tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { DetailSummaryBar, DetailField, DetailSection } from "@/components/shared/detail-workspace";
import { StatusBadge } from "@/components/business/status-badge";
import { EnterpriseButton } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SemanticValue } from "@/components/shared/semantic-value";
import { inventoryService, type StockCard } from "@/services/inventory-service";
import { productCostService, type ProductCostHistoryEntry } from "@/services/product-cost-service";
import type { ProductRow } from "@/services/products-service";
import {
  storeOrdersService,
  type OrderEconomics,
  type CostState,
} from "@/services/store-orders-service";
import { useLocale } from "@/providers/locale-provider";
import { useUserContext } from "@/providers/user-context";
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
 * ADR-0018 (Order Economics M2 gap closure, Part 23-30) — Order
 * traceability mode, added to the SAME Cost Explorer page (never a second
 * "Cost Explorer v2"). Pure display of `OrderEconomicsService`'s already-
 * computed output — the one call this makes (`getEconomics`) is the same
 * canonical read the Profitability tab uses, never a second calculation.
 */
function OrderCostTraceTab({ initialStoreOrderId }: { initialStoreOrderId: string | null }) {
  const { t } = useLocale();
  const router = useRouter();
  const [orderNumberInput, setOrderNumberInput] = useState("");
  const [storeOrderId, setStoreOrderId] = useState<string | null>(initialStoreOrderId);
  const [orderLabel, setOrderLabel] = useState<string | null>(null);
  const [economics, setEconomics] = useState<OrderEconomics | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadById = useCallback(
    (id: string) => {
      setIsLoading(true);
      setError(null);
      storeOrdersService
        .getEconomics(id)
        .then((result) => setEconomics(result))
        .catch((err: unknown) => {
          const message =
            err instanceof ApiError ? err.message : t("costExplorer.order.loadFailed");
          setError(message);
          setEconomics(null);
        })
        .finally(() => setIsLoading(false));
    },
    [t],
  );

  useEffect(() => {
    if (initialStoreOrderId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      loadById(initialStoreOrderId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSearch = () => {
    const query = orderNumberInput.trim();
    if (!query) return;
    setIsLoading(true);
    setError(null);
    storeOrdersService
      .list({ search: query, pageSize: 1 })
      .then((result) => {
        const order = result.items[0];
        if (!order) {
          setEconomics(null);
          setError(t("costExplorer.order.notFound"));
          setIsLoading(false);
          return;
        }
        setStoreOrderId(order.id);
        setOrderLabel(order.internalOrderId);
        loadById(order.id);
      })
      .catch((err: unknown) => {
        toast.error(err instanceof ApiError ? err.message : t("common.loadFailed"));
        setIsLoading(false);
      });
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex max-w-sm gap-2">
        <Input
          value={orderNumberInput}
          onChange={(event) => setOrderNumberInput(event.target.value)}
          placeholder={t("costExplorer.order.searchPlaceholder")}
          onKeyDown={(event) => {
            if (event.key === "Enter") handleSearch();
          }}
        />
        <EnterpriseButton type="button" variant="outline" onClick={handleSearch}>
          {t("common.search")}
        </EnterpriseButton>
      </div>

      {!storeOrderId && !isLoading ? (
        <p className="text-caption text-muted-foreground">{t("costExplorer.order.empty")}</p>
      ) : isLoading ? (
        <p className="text-caption text-muted-foreground">{t("common.loading")}</p>
      ) : error || !economics ? (
        <p className="text-caption text-muted-foreground">{error ?? t("common.noResults")}</p>
      ) : (
        <>
          <div className="flex items-center justify-between gap-2">
            <SemanticValue kind="id">{orderLabel ?? economics.storeOrderId}</SemanticValue>
            <EnterpriseButton
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => router.push(`/store-orders/${economics.storeOrderId}`)}
            >
              {t("costExplorer.order.viewOrder")}
            </EnterpriseButton>
          </div>

          <DetailSummaryBar>
            <DetailField
              label={t("storeOrders.profitability.netRevenue")}
              value={formatMoney(economics.netRevenue)}
            />
            <DetailField
              label={t("storeOrders.profitability.contributionProfit")}
              value={formatMoney(economics.contributionProfit)}
            />
            <DetailField
              label={t("storeOrders.profitability.costState")}
              value={<CostStateBadge state={economics.costState} />}
            />
          </DetailSummaryBar>

          <DetailSection title={t("costExplorer.order.productCogs")}>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("storeOrders.profitability.quantity")}</TableHead>
                  <TableHead>{t("storeOrders.profitability.netRevenue")}</TableHead>
                  <TableHead>{t("storeOrders.profitability.unitCost")}</TableHead>
                  <TableHead>{t("storeOrders.profitability.cogs")}</TableHead>
                  <TableHead>{t("common.actions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {economics.items.map((item, index) => (
                  <TableRow key={`${item.productId}-${index}`}>
                    <TableCell>{item.quantity}</TableCell>
                    <TableCell>{formatMoney(item.netRevenue)}</TableCell>
                    <TableCell>{formatMoney(item.historicalUnitCost)}</TableCell>
                    <TableCell>{formatMoney(item.cogs)}</TableCell>
                    <TableCell>
                      <EnterpriseButton
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          router.push(`/expenses/cost-explorer?productId=${item.productId}`)
                        }
                      >
                        {t("costExplorer.order.viewProductCost")}
                      </EnterpriseButton>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </DetailSection>

          {economics.shippingAttempts.length > 0 && (
            <DetailSection title={t("storeOrders.profitability.shippingAttempts")}>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("storeOrders.profitability.attempt")}</TableHead>
                    <TableHead>{t("shipping.fields.status")}</TableHead>
                    <TableHead>{t("costExplorer.order.operationalCost")}</TableHead>
                    <TableHead>{t("costExplorer.order.confirmedCarrierCost")}</TableHead>
                    <TableHead>{t("costExplorer.order.costSource")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {economics.shippingAttempts.map((attempt) => (
                    <TableRow key={attempt.shipmentId}>
                      <TableCell>#{attempt.attemptNumber}</TableCell>
                      <TableCell>{attempt.status ?? "—"}</TableCell>
                      <TableCell>{formatMoney(attempt.operationalCost)}</TableCell>
                      <TableCell>{formatMoney(attempt.confirmedCarrierCost)}</TableCell>
                      <TableCell>
                        {attempt.costSource === "CONFIRMED_ACTUAL" ? (
                          <EnterpriseButton
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => router.push("/finance/carrier-reconciliation")}
                          >
                            {t("costExplorer.order.costSourceValues.CONFIRMED_ACTUAL")}
                          </EnterpriseButton>
                        ) : (
                          t(
                            `costExplorer.order.costSourceValues.${attempt.costSource}` as MessageKey,
                          )
                        )}
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

          <DetailSection title={t("storeOrders.profitability.fulfillmentCost")}>
            <DetailSummaryBar>
              <DetailField
                label={t("masterData.fields.costAmount")}
                value={formatMoney(economics.fulfillmentCost)}
              />
              <DetailField
                label={t("costExplorer.order.fulfillmentRule")}
                value={economics.fulfillmentCostRuleName ?? "—"}
              />
              <DetailField
                label={t("storeOrders.profitability.costState")}
                value={<CostStateBadge state={economics.fulfillmentCostState} />}
              />
            </DetailSummaryBar>
          </DetailSection>
        </>
      )}
    </div>
  );
}

function CostExplorerPageContent() {
  const { t } = useLocale();
  const { hasPermission } = useUserContext();
  const searchParams = useSearchParams();
  const canViewOrderTrace = hasPermission("orders.profitability.view");
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

  const handleProductChange = useCallback(
    (next: ProductRow) => {
      setProduct(next);
      load(next.id);
    },
    [load],
  );

  useEffect(() => {
    const deepLinkId = searchParams.get("productId");
    if (!deepLinkId) return;
    productsService
      .get(deepLinkId)
      .then((row) => handleProductChange(row))
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const productPanel = (
    <div className="flex flex-col gap-3">
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
    </div>
  );

  const initialMode = searchParams.get("mode") === "order" ? "order" : "product";
  const initialStoreOrderId = searchParams.get("storeOrderId");

  return (
    <PageWorkspace title={t("costExplorer.title")} description={t("costExplorer.description")}>
      {canViewOrderTrace ? (
        <EntityTabs
          defaultValue={initialMode}
          tabs={[
            { value: "product", label: t("costExplorer.tabs.product"), content: productPanel },
            {
              value: "order",
              label: t("costExplorer.tabs.order"),
              content: <OrderCostTraceTab initialStoreOrderId={initialStoreOrderId} />,
            },
          ]}
        />
      ) : (
        productPanel
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
