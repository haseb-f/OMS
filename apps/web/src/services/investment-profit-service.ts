import { apiClient } from "./api-client";
import { buildQueryString } from "@/lib/query-string";
import type { MasterDataActivityEntry } from "./master-data-service";

export type ProfitCalculationStatus = "ESTIMATED" | "APPROVED";

export interface ProfitInvestorShareRow {
  investorId: string;
  investorName: string;
  subscriptionId: string;
  participationPercent: number;
  profitShareAmount: number;
}

export interface ProfitBreakdown {
  opportunityId: string;
  revenue: number;
  cogs: number;
  expenses: number;
  returnsAdjustment: number;
  netProfit: number;
  investorSharePercent: number;
  investorProfitPool: number;
  companyProfitPortion: number;
  revenueLineCount: number;
  netUnitsCount: number;
  expenseLineCount: number;
  investorShares: ProfitInvestorShareRow[];
}

export interface ProfitCalculationRow extends ProfitBreakdown {
  id: string;
  status: ProfitCalculationStatus;
  calculatedBy: string | null;
  calculatedAt: string;
  approvedBy: string | null;
  approvedAt: string | null;
}

const basePath = "/investment-profit";

export const investmentProfitService = {
  estimate: (opportunityId: string) =>
    apiClient.get<ProfitBreakdown>(`${basePath}/estimate${buildQueryString({ opportunityId })}`),
  list: (opportunityId: string) =>
    apiClient.get<ProfitCalculationRow[]>(`${basePath}${buildQueryString({ opportunityId })}`),
  get: (id: string) => apiClient.get<ProfitCalculationRow>(`${basePath}/${id}`),
  activity: (id: string) => apiClient.get<MasterDataActivityEntry[]>(`${basePath}/${id}/activity`),
  calculate: (opportunityId: string) =>
    apiClient.post<ProfitCalculationRow>(`${basePath}${buildQueryString({ opportunityId })}`),
  approve: (id: string) => apiClient.post<ProfitCalculationRow>(`${basePath}/${id}/approve`),
};
