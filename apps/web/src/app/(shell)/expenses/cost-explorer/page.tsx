"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
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
  tableNumericCellClass,
} from "@/components/ui/table";
import { DetailSummaryBar, DetailField, DetailSection } from "@/components/shared/detail-workspace";
import { StatusBadge } from "@/components/business/status-badge";
import { EnterpriseButton } from "@/components/ui/button";
import { SearchInput } from "@/components/shared/search-input";
import { SemanticValue } from "@/components/shared/semantic-value";
import { MoneyValue } from "@/components/shared/money-value";
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
import { reportApiError, toast } from "@/lib/toast";
import { formatDateTime, toISODate } from "@/lib/date";
import { ApiError } from "@/services/api-client";
import { PermissionGate } from "@/components/shared/permission-gate";
import type { MessageKey } from "@/i18n/translate";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  EnterpriseDateRangePicker,
  type DateRangeValue,
} from "@/components/shared/date-range-picker";
import { exportRowsToCsv } from "@/components/master-data/enterprise-data-table";
import { formatAmount, formatMoney as formatMoneyShared } from "@/lib/money";
import {
  FinancialReport,
  type FinancialReportLine,
} from "@/components/accounting/financial-report";
import {
  EMPTY_REPORT_FILTERS,
  type ReportFilterValue,
} from "@/components/accounting/report-filter-bar";
import {
  costAnalyticsService,
  type ManagementPnl,
  type ProfitabilityDimension,
  type ProfitabilityResult,
  type ProfitabilityRow,
} from "@/services/cost-analytics-service";

function formatCostAmount(value: number | string | null) {
  return value === null ? "—" : formatAmount(value);
}

/** Summary-field amount: `—` (field hidden) when missing, otherwise a tabular money run. */
function costFieldValue(value: number | string | null) {
  return value === null ? "—" : <MoneyValue value={value} />;
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
  // Agent orders have no company economics (the goods are the agent's) — the
  // economics call is skipped and a note points to the agent statement.
  const [agentOrder, setAgentOrder] = useState<{ agentId: string | null } | null>(null);

  const loadById = useCallback(
    (id: string) => {
      setIsLoading(true);
      setError(null);
      setAgentOrder(null);
      storeOrdersService
        .getEconomics(id)
        .then((result) => setEconomics(result))
        .catch((err: unknown) => {
          setEconomics(null);
          // A deep link (?storeOrderId=) to an agent order: the API refuses with this code.
          if (
            err instanceof ApiError &&
            (err.code as string) === "AGENT_ORDER_NO_COMPANY_ECONOMICS"
          ) {
            setAgentOrder({ agentId: null });
            return;
          }
          const message =
            err instanceof ApiError ? err.message : t("costExplorer.order.loadFailed");
          setError(message);
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
        if (order.agentId) {
          setEconomics(null);
          setAgentOrder({ agentId: order.agentId });
          setIsLoading(false);
          return;
        }
        loadById(order.id);
      })
      .catch((err: unknown) => {
        toast.error(err instanceof ApiError ? err.message : t("common.loadFailed"));
        setIsLoading(false);
      });
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="max-w-sm">
        <SearchInput
          value={orderNumberInput}
          onValueChange={setOrderNumberInput}
          onSubmit={() => handleSearch()}
          placeholder={t("costExplorer.order.searchPlaceholder")}
        />
      </div>

      {!storeOrderId && !isLoading ? (
        <p className="text-caption text-muted-foreground">{t("costExplorer.order.empty")}</p>
      ) : isLoading ? (
        <p className="text-caption text-muted-foreground">{t("common.loading")}</p>
      ) : agentOrder ? (
        <p className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-caption text-muted-foreground">
          <span>{t("agents.storeOrder.noEconomics")}</span>
          {agentOrder.agentId ? (
            <EnterpriseButton
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => router.push(`/agents/${agentOrder.agentId}?tab=statement`)}
            >
              {t("agents.storeOrder.openAgentStatement")}
            </EnterpriseButton>
          ) : storeOrderId ? (
            <EnterpriseButton
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => router.push(`/store-orders/${storeOrderId}`)}
            >
              {t("costExplorer.order.viewOrder")}
            </EnterpriseButton>
          ) : null}
        </p>
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
              value={costFieldValue(economics.netRevenue)}
            />
            <DetailField
              label={t("storeOrders.profitability.contributionProfit")}
              value={costFieldValue(economics.contributionProfit)}
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
                  <TableHead className={tableNumericCellClass}>
                    {t("storeOrders.profitability.quantity")}
                  </TableHead>
                  <TableHead className={tableNumericCellClass}>
                    {t("storeOrders.profitability.netRevenue")}
                  </TableHead>
                  <TableHead className={tableNumericCellClass}>
                    {t("storeOrders.profitability.unitCost")}
                  </TableHead>
                  <TableHead className={tableNumericCellClass}>
                    {t("storeOrders.profitability.cogs")}
                  </TableHead>
                  <TableHead>{t("common.actions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {economics.items.map((item, index) => (
                  <TableRow key={`${item.productId}-${index}`}>
                    <TableCell numeric>{item.quantity}</TableCell>
                    <TableCell numeric>{formatCostAmount(item.netRevenue)}</TableCell>
                    <TableCell numeric>{formatCostAmount(item.historicalUnitCost)}</TableCell>
                    <TableCell numeric>{formatCostAmount(item.cogs)}</TableCell>
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
                    <TableHead className={tableNumericCellClass}>
                      {t("costExplorer.order.operationalCost")}
                    </TableHead>
                    <TableHead className={tableNumericCellClass}>
                      {t("costExplorer.order.confirmedCarrierCost")}
                    </TableHead>
                    <TableHead>{t("costExplorer.order.costSource")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {economics.shippingAttempts.map((attempt) => (
                    <TableRow key={attempt.shipmentId}>
                      <TableCell>#{attempt.attemptNumber}</TableCell>
                      <TableCell>{attempt.status ?? "—"}</TableCell>
                      <TableCell numeric>{formatCostAmount(attempt.operationalCost)}</TableCell>
                      <TableCell numeric>
                        {formatCostAmount(attempt.confirmedCarrierCost)}
                      </TableCell>
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
                    <TableHead className={tableNumericCellClass}>
                      {t("storeOrders.profitability.amount")}
                    </TableHead>
                    <TableHead className={tableNumericCellClass}>
                      {t("storeOrders.profitability.fee")}
                    </TableHead>
                    <TableHead>{t("storeOrders.profitability.feeSource")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {economics.payments.map((payment) => (
                    <TableRow key={payment.paymentId}>
                      <TableCell numeric>{formatCostAmount(payment.amount)}</TableCell>
                      <TableCell numeric>{formatCostAmount(payment.feeAmount)}</TableCell>
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
                value={costFieldValue(economics.fulfillmentCost)}
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

/** The calendar day the picker selected, as "YYYY-MM-DD" — never UTC-shifted (the API reads it as an Africa/Cairo business day). */
function dateToIso(date: Date | null): string | undefined {
  if (!date) return undefined;
  return toISODate(date);
}

const COST_STATE_COVERAGE_TONE: Record<CostState, "success" | "warning" | "neutral"> = {
  COMPLETE: "success",
  PARTIAL: "warning",
  UNKNOWN: "neutral",
};

/**
 * M3 (Cost Module completion) — Management P&L, the same additive-tab
 * pattern `OrderCostTraceTab` established. Revenue/COGS/Gross Profit/Direct
 * Costs/Contribution Profit come from `CostAnalyticsService`'s rollup of
 * `OrderEconomicsService` (never recomputed here); Operating Expenses/Net
 * Profit come live from the GL. Gated by `cost-analytics.viewPnl` — a
 * strictly narrower permission than the tab's own visibility check, set by
 * the parent.
 */
function ManagementPnlTab() {
  const { t } = useLocale();
  const [filters, setFilters] = useState<ReportFilterValue>(EMPTY_REPORT_FILTERS);
  const [pnl, setPnl] = useState<ManagementPnl | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const dateRange = filters.dateRange;

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsLoading(true);
    costAnalyticsService
      .getManagementPnl({ dateFrom: dateToIso(dateRange.from), dateTo: dateToIso(dateRange.to) })
      .then(setPnl)
      .catch((error: unknown) => {
        setPnl(null);
        toast.error(error instanceof ApiError ? error.message : t("common.loadFailed"));
      })
      .finally(() => setIsLoading(false));
  }, [dateRange, t]);

  // The management P&L as shared report lines. Costs are shown as negatives
  // (presentation only; every figure is the API's own).
  const lines = useMemo<FinancialReportLine[]>(() => {
    if (!pnl) return [];
    const reconciliation = pnl.incomeStatementReconciliation;
    const row = (
      id: string,
      labelKey: MessageKey,
      value: number,
      kind: FinancialReportLine["kind"] = "posting",
      children: FinancialReportLine[] = [],
    ): FinancialReportLine => {
      const label = t(labelKey);
      return {
        id: `pnl:${id}`,
        parentId: null,
        kind,
        level: 0,
        label,
        labelEn: label,
        expandable: children.length > 0,
        values: { amount: value },
        children,
      };
    };
    const opexAccounts = pnl.operatingExpenses.accounts.map((account): FinancialReportLine => ({
      id: `pnl:opex:${account.accountId}`,
      parentId: "pnl:opex",
      kind: "posting",
      level: 1,
      code: account.accountCode,
      label: account.accountName,
      labelEn: account.accountName,
      expandable: false,
      values: { amount: -account.balance },
      children: [],
    }));
    return [
      row("revenue", "costExplorer.pnl.revenue", pnl.revenue),
      row("cogs", "costExplorer.pnl.cogs", -pnl.cogs),
      row("grossProfit", "costExplorer.pnl.grossProfit", pnl.grossProfit, "subtotal"),
      row("shipping", "costExplorer.pnl.directCostsShipping", -pnl.directCosts.shipping),
      row("paymentFees", "costExplorer.pnl.directCostsPaymentFees", -pnl.directCosts.paymentFees),
      row("fulfillment", "costExplorer.pnl.directCostsFulfillment", -pnl.directCosts.fulfillment),
      row(
        "contributionProfit",
        "costExplorer.pnl.contributionProfit",
        pnl.contributionProfit,
        "subtotal",
      ),
      row(
        "opex",
        "costExplorer.pnl.operatingExpenses",
        -pnl.operatingExpenses.total,
        "group",
        opexAccounts,
      ),
      row("operatingProfit", "costExplorer.pnl.operatingProfit", pnl.operatingProfit, "result"),
      // Bridge to the Income Statement for the same period: management OP +
      // difference = Income Statement OP (each bridge row is its effect).
      ...(reconciliation
        ? [
            row(
              "isDifference",
              "costExplorer.pnl.differenceToIncomeStatement",
              -reconciliation.difference,
              "group",
              reconciliation.bridge
                .filter((item) => item.effect !== 0)
                .map((item): FinancialReportLine => ({
                  id: `pnl:bridge:${item.key}`,
                  parentId: "pnl:isDifference",
                  kind: "posting",
                  level: 1,
                  label: t(`costExplorer.pnl.bridge.${item.key}` as MessageKey),
                  labelEn: t(`costExplorer.pnl.bridge.${item.key}` as MessageKey),
                  expandable: false,
                  values: { amount: -item.effect },
                  children: [],
                })),
            ),
            row(
              "isOperatingProfit",
              "costExplorer.pnl.incomeStatementOperatingProfit",
              reconciliation.incomeStatementOperatingProfit,
              "subtotal",
            ),
          ]
        : []),
    ];
  }, [pnl, t]);

  return (
    <div className="flex flex-col gap-3">
      <FinancialReport
        lines={lines}
        columns={[{ key: "amount", labelKey: "costExplorer.pnl.amount", emphasize: true }]}
        isLoading={isLoading}
        filters={filters}
        onFiltersChange={setFilters}
        filterFields={["dateRange"]}
        defaultExpanded="none"
        nameHeaderKey="costExplorer.pnl.title"
        printTitle={t("costExplorer.pnl.title")}
        exportFileName="management-pnl.xlsx"
        notice={
          pnl ? (
            <div className="flex flex-wrap items-center gap-2">
              <CostStateBadge state={pnl.costState} />
              {pnl.scope.truncated ? (
                <span className="text-warning-soft-foreground">
                  {t("costExplorer.pnl.truncatedWarning")}
                </span>
              ) : null}
            </div>
          ) : undefined
        }
        summary={
          pnl
            ? {
                items: [
                  {
                    id: "revenue",
                    label: t("costExplorer.pnl.revenue"),
                    value: pnl.revenue,
                    tone: "revenue",
                  },
                  {
                    id: "grossProfit",
                    label: t("costExplorer.pnl.grossProfit"),
                    value: pnl.grossProfit,
                  },
                  {
                    id: "contributionProfit",
                    label: t("costExplorer.pnl.contributionProfit"),
                    value: pnl.contributionProfit,
                  },
                  {
                    id: "operatingExpenses",
                    label: t("costExplorer.pnl.operatingExpenses"),
                    value: pnl.operatingExpenses.total,
                    tone: "expense",
                  },
                  {
                    id: "operatingProfit",
                    label: t("costExplorer.pnl.operatingProfit"),
                    value: pnl.operatingProfit,
                    emphasize: true,
                    tone: "result",
                  },
                ],
              }
            : undefined
        }
      />

      {pnl ? (
        <>
          <DetailSection title={t("costExplorer.pnl.glReconciliation")}>
            <DetailSummaryBar>
              <DetailField
                label={t("costExplorer.pnl.revenueFromGl")}
                value={
                  <span className="num">{formatAmount(pnl.glReconciliation.revenueFromGl)}</span>
                }
              />
              <DetailField
                label={t("costExplorer.pnl.expenseFromGl")}
                value={
                  <span className="num">{formatAmount(pnl.glReconciliation.expenseFromGl)}</span>
                }
              />
              <DetailField
                label={t("costExplorer.pnl.netProfitFromGl")}
                value={
                  <span className="num">{formatAmount(pnl.glReconciliation.netProfitFromGl)}</span>
                }
              />
            </DetailSummaryBar>
          </DetailSection>

          <DetailSection title={t("costExplorer.pnl.coverage")}>
            <DetailSummaryBar>
              <DetailField
                label={t("costExplorer.pnl.coverageOrders")}
                value={pnl.coverage.orderCount}
              />
              <DetailField
                label={t("storeOrders.profitability.costStateValues.COMPLETE")}
                value={pnl.coverage.complete}
              />
              <DetailField
                label={t("storeOrders.profitability.costStateValues.PARTIAL")}
                value={pnl.coverage.partial}
              />
              <DetailField
                label={t("storeOrders.profitability.costStateValues.UNKNOWN")}
                value={pnl.coverage.unknown}
              />
            </DetailSummaryBar>
          </DetailSection>
        </>
      ) : null}
    </div>
  );
}

const DIMENSION_VALUES: ProfitabilityDimension[] = [
  "PRODUCT",
  "ORDER",
  "CUSTOMER",
  "EMPLOYEE",
  "CHANNEL",
  "COUNTRY",
  "PERIOD",
];

/**
 * M3 (Cost Module completion) — multi-dimensional Profitability Analytics.
 * PRODUCT never shows a Contribution Profit column (see
 * `CostAnalyticsService`'s own comment — direct costs aren't allocated to
 * line items without the M4 Cost Allocation layer); every other dimension
 * groups whole-Order economics. Row click drills into the Order tab for a
 * single order, or the Store Orders list filtered to the dimension value
 * for everything else.
 */
function ProfitabilityAnalyticsTab() {
  const { t } = useLocale();
  const router = useRouter();
  const [dimension, setDimension] = useState<ProfitabilityDimension>("PRODUCT");
  const [dateRange, setDateRange] = useState<DateRangeValue>({ from: null, to: null });
  const [result, setResult] = useState<ProfitabilityResult | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsLoading(true);
    costAnalyticsService
      .getProfitabilityAnalytics({
        dimension,
        dateFrom: dateToIso(dateRange.from),
        dateTo: dateToIso(dateRange.to),
        page: 1,
        pageSize: 100,
      })
      .then(setResult)
      .catch((error: unknown) => {
        setResult(null);
        toast.error(error instanceof ApiError ? error.message : t("common.loadFailed"));
      })
      .finally(() => setIsLoading(false));
  }, [dimension, dateRange, t]);

  const handleRowClick = (row: ProfitabilityRow) => {
    if (dimension === "ORDER") {
      router.push(`/expenses/cost-explorer?mode=order&storeOrderId=${row.dimensionValue}`);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={dimension}
            onValueChange={(v) => setDimension(v as ProfitabilityDimension)}
          >
            {/* A view switch with no "all" state (one dimension is always active), so a
                plain short-enum Select sized by its content, not a SelectFilter. */}
            <SelectTrigger size="sm" aria-label={t("pickers.labels.costDimension")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DIMENSION_VALUES.map((d) => (
                <SelectItem key={d} value={d}>
                  {t(`costExplorer.analytics.dimensions.${d}` as MessageKey)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <EnterpriseDateRangePicker value={dateRange} onChange={setDateRange} />
        </div>
        {result && result.rows.length > 0 && (
          <EnterpriseButton
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              exportRowsToCsv(
                result.rows as unknown as Record<string, unknown>[],
                [
                  "dimensionLabel",
                  "orderCount",
                  "netRevenue",
                  "cogs",
                  "grossProfit",
                  "contributionProfit",
                ],
                `profitability-${dimension.toLowerCase()}.csv`,
              )
            }
          >
            {t("table.export")}
          </EnterpriseButton>
        )}
      </div>

      {isLoading ? (
        <p className="text-caption text-muted-foreground">{t("common.loading")}</p>
      ) : !result || result.rows.length === 0 ? (
        <p className="text-caption text-muted-foreground">{t("common.noResults")}</p>
      ) : (
        <>
          {result.scope.truncated && (
            <p className="text-caption text-warning">{t("costExplorer.pnl.truncatedWarning")}</p>
          )}
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>
                  {t(`costExplorer.analytics.dimensions.${dimension}` as MessageKey)}
                </TableHead>
                <TableHead className={tableNumericCellClass}>
                  {t("costExplorer.analytics.orderCount")}
                </TableHead>
                <TableHead className={tableNumericCellClass}>
                  {t("storeOrders.profitability.netRevenue")}
                </TableHead>
                <TableHead className={tableNumericCellClass}>
                  {t("storeOrders.profitability.cogs")}
                </TableHead>
                <TableHead className={tableNumericCellClass}>
                  {t("costExplorer.analytics.grossProfit")}
                </TableHead>
                <TableHead className={tableNumericCellClass}>
                  {t("storeOrders.profitability.contributionProfit")}
                </TableHead>
                <TableHead>{t("storeOrders.profitability.costState")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {result.rows.map((row) => (
                <TableRow
                  key={row.dimensionValue}
                  interactive={dimension === "ORDER"}
                  onClick={dimension === "ORDER" ? () => handleRowClick(row) : undefined}
                >
                  <TableCell>{row.dimensionLabel}</TableCell>
                  <TableCell numeric>{row.orderCount}</TableCell>
                  <TableCell numeric>{formatMoneyShared(row.netRevenue)}</TableCell>
                  <TableCell numeric>{formatMoneyShared(row.cogs)}</TableCell>
                  <TableCell numeric>{formatMoneyShared(row.grossProfit)}</TableCell>
                  <TableCell numeric>
                    {row.contributionProfit === null
                      ? "—"
                      : formatMoneyShared(row.contributionProfit)}
                  </TableCell>
                  <TableCell>
                    <StatusBadge
                      label={t(
                        `storeOrders.profitability.costStateValues.${row.costState}` as MessageKey,
                      )}
                      tone={COST_STATE_COVERAGE_TONE[row.costState]}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
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
  const canViewAnalytics = hasPermission("cost-analytics.view");
  const canViewPnl = hasPermission("cost-analytics.viewPnl");
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
        reportApiError(error, "errors.loadFailed");
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
              value={costFieldValue(stockCard?.averageCost ?? null)}
            />
            <DetailField
              label={t("costExplorer.onHand")}
              value={stockCard ? <span className="num">{stockCard.onHand}</span> : "—"}
            />
            <DetailField
              label={t("costExplorer.stockValue")}
              value={costFieldValue(stockCard?.stockValue ?? null)}
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
                  <TableHead className={tableNumericCellClass}>
                    {t("costExplorer.fields.previousCost")}
                  </TableHead>
                  <TableHead className={tableNumericCellClass}>
                    {t("costExplorer.fields.newCost")}
                  </TableHead>
                  <TableHead className={tableNumericCellClass}>
                    {t("costExplorer.fields.delta")}
                  </TableHead>
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
                      <TableCell>
                        <span className="num">{formatDateTime(entry.createdAt)}</span>
                      </TableCell>
                      <TableCell numeric>{formatCostAmount(previous)}</TableCell>
                      <TableCell numeric>{formatCostAmount(next)}</TableCell>
                      <TableCell
                        numeric
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
                        {delta === null ? "—" : `${delta > 0 ? "+" : ""}${formatCostAmount(delta)}`}
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

  const requestedMode = searchParams.get("mode");
  const initialMode = ["order", "analytics", "pnl"].includes(requestedMode ?? "")
    ? (requestedMode as string)
    : "product";
  const initialStoreOrderId = searchParams.get("storeOrderId");

  const extraTabs = [
    canViewOrderTrace && {
      value: "order",
      label: t("costExplorer.tabs.order"),
      content: <OrderCostTraceTab initialStoreOrderId={initialStoreOrderId} />,
    },
    canViewAnalytics && {
      value: "analytics",
      label: t("costExplorer.tabs.analytics"),
      content: <ProfitabilityAnalyticsTab />,
    },
    canViewPnl && {
      value: "pnl",
      label: t("costExplorer.tabs.pnl"),
      content: <ManagementPnlTab />,
    },
  ].filter(Boolean) as { value: string; label: string; content: ReactNode }[];

  return (
    <PageWorkspace title={t("costExplorer.title")} description={t("costExplorer.description")}>
      {extraTabs.length > 0 ? (
        <EntityTabs
          defaultValue={initialMode}
          tabs={[
            { value: "product", label: t("costExplorer.tabs.product"), content: productPanel },
            ...extraTabs,
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
