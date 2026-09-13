import { apiClient } from "./api-client";
import { buildQueryString } from "@/lib/query-string";
import type { MasterDataActivityEntry } from "./master-data-service";

export type ProfitDistributionStatus =
  "DRAFT" | "APPROVED" | "PARTIALLY_PAID" | "PAID" | "CANCELLED";

export type InvestorDistributionStatus =
  "PENDING" | "PAYABLE" | "PARTIALLY_PAID" | "PAID" | "CANCELLED";

export interface InvestorDistributionRow {
  id: string;
  investorId: string;
  investorName: string;
  subscriptionId: string;
  entitledAmount: number;
  paidAmount: number;
  outstandingAmount: number;
  status: InvestorDistributionStatus;
}

export interface ProfitDistributionRow {
  id: string;
  code: string;
  opportunityId: string;
  opportunityCode: string;
  profitCalculationId: string;
  totalInvestorProfit: number;
  totalPaid: number;
  totalOutstanding: number;
  status: ProfitDistributionStatus;
  periodStart: string | null;
  periodEnd: string | null;
  createdBy: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  notes: string | null;
  createdAt: string;
  investorDistributions: InvestorDistributionRow[];
}

export interface DistributionPreviewShare {
  investorId: string;
  investorName: string;
  subscriptionId: string;
  participationPercent: number;
  profitShareAmount: number;
}

export interface DistributionPreview {
  profitCalculationId: string;
  opportunityId: string;
  status: "ESTIMATED" | "APPROVED";
  investorProfitPool: number;
  alreadyDistributed: boolean;
  existingDistributionId: string | null;
  existingDistributionCode: string | null;
  investorShares: DistributionPreviewShare[];
}

export interface OpportunityFinancialSummary {
  opportunityId: string;
  status: string;
  confirmedCapital: number;
  approvedNetProfit: number | null;
  investorProfitPool: number | null;
  distributedProfit: number;
  paidProfit: number;
  outstandingInvestorProfit: number;
  capitalReturned: number;
}

export interface CreateProfitDistributionPayload {
  profitCalculationId: string;
  periodStart?: string;
  periodEnd?: string;
  notes?: string;
}

const basePath = "/investment-distributions";

export const investmentDistributionsService = {
  preview: (profitCalculationId: string) =>
    apiClient.get<DistributionPreview>(
      `${basePath}/preview${buildQueryString({ profitCalculationId })}`,
    ),
  opportunitySummary: (opportunityId: string) =>
    apiClient.get<OpportunityFinancialSummary>(
      `${basePath}/opportunity-summary${buildQueryString({ opportunityId })}`,
    ),
  list: (
    params: {
      opportunityId?: string;
      investorId?: string;
      status?: ProfitDistributionStatus[];
      page?: number;
      pageSize?: number;
    } = {},
  ) =>
    apiClient.get<{
      items: ProfitDistributionRow[];
      total: number;
      page: number;
      pageSize: number;
    }>(`${basePath}${buildQueryString(params)}`),
  get: (id: string) => apiClient.get<ProfitDistributionRow>(`${basePath}/${id}`),
  create: (dto: CreateProfitDistributionPayload) =>
    apiClient.post<ProfitDistributionRow>(basePath, dto),
  approve: (id: string) => apiClient.post<ProfitDistributionRow>(`${basePath}/${id}/approve`),
  cancel: (id: string) => apiClient.post<ProfitDistributionRow>(`${basePath}/${id}/cancel`),
  activity: (id: string) => apiClient.get<MasterDataActivityEntry[]>(`${basePath}/${id}/activity`),
};
