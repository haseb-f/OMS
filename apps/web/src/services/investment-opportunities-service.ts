import { apiClient } from "./api-client";
import { buildQueryString } from "@/lib/query-string";
import type { MasterDataActivityEntry } from "./master-data-service";

export type InvestmentOpportunityStatus =
  "DRAFT" | "OPEN" | "FUNDED" | "ACTIVE" | "ENDED" | "SETTLED" | "CLOSED" | "CANCELLED";

export interface OpportunityProductInput {
  productId: string;
  fundedUnits: number;
  fundedUnitCost: number;
}

export interface OpportunityProductRow extends OpportunityProductInput {
  id: string;
  productName: string;
  productSku: string;
  fundedCapital: number;
}

export interface OpportunitySubscriptionRow {
  id: string;
  investorId: string;
  investorName: string;
  committedAmount: number;
  fundedAmount: number;
  participationPercent: number;
  status: string;
}

export interface InvestmentOpportunityRow {
  id: string;
  code: string;
  nameAr: string;
  nameEn: string | null;
  description: string | null;
  currency: { id: string; code: string; name: string };
  startDate: string;
  endDate: string;
  investorNetProfitSharePercent: number;
  status: InvestmentOpportunityStatus;
  activatedAt: string | null;
  endedAt: string | null;
  products: OpportunityProductRow[];
  subscriptions: OpportunitySubscriptionRow[];
  targetCapital: number;
  committedCapital: number;
  confirmedFundedCapital: number;
  fundingPercent: number;
  investorsCount: number;
  productsCount: number;
  totalFundedUnits: number;
  daysRemaining: number;
  isPastEndDate: boolean;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface CreateInvestmentOpportunityPayload {
  nameAr: string;
  nameEn?: string;
  description?: string;
  currencyId: string;
  startDate: string;
  endDate: string;
  investorNetProfitSharePercent: number;
  products: OpportunityProductInput[];
}

export type UpdateInvestmentOpportunityPayload = Partial<CreateInvestmentOpportunityPayload>;

export interface FindInvestmentOpportunitiesParams {
  status?: InvestmentOpportunityStatus[];
  search?: string;
  dateFrom?: string;
  dateTo?: string;
  page?: number;
  pageSize?: number;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
  [key: string]: string | number | boolean | string[] | undefined;
}

const basePath = "/investment-opportunities";

export const investmentOpportunitiesService = {
  list: (params: FindInvestmentOpportunitiesParams = {}) =>
    apiClient.get<{
      items: InvestmentOpportunityRow[];
      total: number;
      page: number;
      pageSize: number;
    }>(`${basePath}${buildQueryString(params)}`),
  get: (id: string) => apiClient.get<InvestmentOpportunityRow>(`${basePath}/${id}`),
  create: (dto: CreateInvestmentOpportunityPayload) =>
    apiClient.post<InvestmentOpportunityRow>(basePath, dto),
  update: (id: string, dto: UpdateInvestmentOpportunityPayload) =>
    apiClient.patch<InvestmentOpportunityRow>(`${basePath}/${id}`, dto),
  open: (id: string) => apiClient.post<InvestmentOpportunityRow>(`${basePath}/${id}/open`),
  activate: (id: string) => apiClient.post<InvestmentOpportunityRow>(`${basePath}/${id}/activate`),
  end: (id: string) => apiClient.post<InvestmentOpportunityRow>(`${basePath}/${id}/end`),
  cancel: (id: string) => apiClient.post<InvestmentOpportunityRow>(`${basePath}/${id}/cancel`),
  close: (id: string) => apiClient.post<InvestmentOpportunityRow>(`${basePath}/${id}/close`),
  archive: (id: string) => apiClient.post<InvestmentOpportunityRow>(`${basePath}/${id}/archive`),
  activity: (id: string) => apiClient.get<MasterDataActivityEntry[]>(`${basePath}/${id}/activity`),
};
