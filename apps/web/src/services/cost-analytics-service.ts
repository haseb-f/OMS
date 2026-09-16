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
  operatingExpenses: {
    total: number;
    accounts: { accountId: string; accountCode: string; accountName: string; balance: number }[];
  };
  operatingProfit: number;
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
