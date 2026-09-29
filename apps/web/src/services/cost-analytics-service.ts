import { apiClient } from "./api-client";
import { buildQueryString } from "@/lib/query-string";
import type { CostState } from "./store-orders-service";

export interface CostAnalyticsScopeParams {
  dateFrom?: string;
  dateTo?: string;
  partnerId?: string;
  employeeId?: string;
  sourceChannel?: string;
  countryId?: string;
  costCenterId?: string;
  [key: string]: string | number | boolean | undefined;
}

export type ManagementPnlBridgeKey =
  | "NET_REVENUE"
  | "COST_OF_SALES"
  | "SHIPPING"
  | "PAYMENT_FEES"
  | "FULFILLMENT"
  | "CONTRIBUTION_NOT_COMPUTED";

export interface ManagementPnl {
  scope: {
    dateFrom: string | null;
    dateTo: string | null;
    scopedOrderCount: number;
    truncated: boolean;
  };
  revenue: number;
  cogs: number;
  grossProfit: number;
  directCosts: { shipping: number; paymentFees: number; fulfillment: number; total: number };
  contributionProfit: number;
  contributionMarginPercent: number | null;
  coverage: { orderCount: number; complete: number; partial: number; unknown: number };
  costState: CostState;
  /** GL operating expenses NOT attributed at order level (other selling + G&A). */
  operatingExpenses: {
    total: number;
    accounts: { accountId: string; accountCode: string; accountName: string; balance: number }[];
    basis?: "NOT_ATTRIBUTED_AT_ORDER_LEVEL";
  };
  /** GL side of the costs already in Contribution Profit — not subtracted again. */
  attributedCostsInGl?: {
    costOfSales: number;
    shipping: number;
    paymentFees: number;
    fulfillment: number;
  };
  operatingProfit: number;
  /** Bridge to the Income Statement operating profit for the same Cairo period. */
  incomeStatementReconciliation?: {
    managementOperatingProfit: number;
    incomeStatementOperatingProfit: number;
    difference: number;
    bridge: {
      key: ManagementPnlBridgeKey;
      orderLevel: number;
      gl: number;
      effect: number;
    }[];
    balanced: boolean;
  };
  glReconciliation: { revenueFromGl: number; expenseFromGl: number; netProfitFromGl: number };
}

export type ProfitabilityDimension =
  "PRODUCT" | "ORDER" | "CUSTOMER" | "EMPLOYEE" | "CHANNEL" | "COUNTRY" | "PERIOD";

export interface ProfitabilityRow {
  dimensionValue: string;
  dimensionLabel: string;
  orderCount: number;
  totalQuantity: number;
  netRevenue: number;
  cogs: number;
  grossProfit: number;
  totalDirectCost: number | null;
  contributionProfit: number | null;
  contributionMarginPercent: number | null;
  costState: CostState;
}

export interface ProfitabilityResult {
  dimension: ProfitabilityDimension;
  scope: { scopedOrderCount: number; truncated: boolean };
  total: number;
  page: number;
  pageSize: number;
  rows: ProfitabilityRow[];
}

export interface ProfitabilityQueryParams extends CostAnalyticsScopeParams {
  dimension: ProfitabilityDimension;
  periodGranularity?: "day" | "week" | "month";
  page?: number;
  pageSize?: number;
}

export const costAnalyticsService = {
  getManagementPnl: (params: CostAnalyticsScopeParams = {}) =>
    apiClient.get<ManagementPnl>(`/cost-analytics/pnl${buildQueryString(params)}`),
  getProfitabilityAnalytics: (params: ProfitabilityQueryParams) =>
    apiClient.get<ProfitabilityResult>(
      `/cost-analytics/profitability${buildQueryString(params as Record<string, unknown>)}`,
    ),
};
