import { apiClient } from "./api-client";
import { buildQueryString } from "@/lib/query-string";

export type InvestorSubscriptionStatus =
  "PENDING" | "COMMITTED" | "PARTIALLY_FUNDED" | "FUNDED" | "CANCELLED";

export interface InvestorSubscriptionRow {
  id: string;
  investorId: string;
  investorName: string;
  opportunityId: string;
  opportunityCode: string;
  opportunityName: string;
  opportunityStatus: string;
  committedAmount: number;
  fundedAmount: number;
  participationPercent: number;
  status: InvestorSubscriptionStatus;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface CreateInvestorSubscriptionPayload {
  investorId: string;
  opportunityId: string;
  committedAmount: number;
}

const basePath = "/investor-subscriptions";

export const investorSubscriptionsService = {
  list: (
    params: { opportunityId?: string; investorId?: string; page?: number; pageSize?: number } = {},
  ) =>
    apiClient.get<{
      items: InvestorSubscriptionRow[];
      total: number;
      page: number;
      pageSize: number;
    }>(`${basePath}${buildQueryString(params)}`),
  get: (id: string) => apiClient.get<InvestorSubscriptionRow>(`${basePath}/${id}`),
  create: (dto: CreateInvestorSubscriptionPayload) =>
    apiClient.post<InvestorSubscriptionRow>(basePath, dto),
  update: (id: string, committedAmount: number) =>
    apiClient.patch<InvestorSubscriptionRow>(`${basePath}/${id}`, { committedAmount }),
  cancel: (id: string) => apiClient.post<InvestorSubscriptionRow>(`${basePath}/${id}/cancel`),
};
