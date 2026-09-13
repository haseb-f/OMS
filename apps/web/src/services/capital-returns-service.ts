import { apiClient } from "./api-client";
import { buildQueryString } from "@/lib/query-string";
import type { MasterDataActivityEntry } from "./master-data-service";

export type CapitalReturnStatus = "DRAFT" | "APPROVED" | "PAID" | "CANCELLED";

export interface CapitalReturnRow {
  id: string;
  code: string;
  investorId: string;
  investorName: string;
  subscriptionId: string;
  opportunityId: string;
  opportunityCode: string;
  amount: number;
  date: string;
  financialAccount: { id: string; code: string; name: string } | null;
  referenceNumber: string | null;
  status: CapitalReturnStatus;
  createdBy: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  paidBy: string | null;
  paidAt: string | null;
  notes: string | null;
  createdAt: string;
}

export interface CreateCapitalReturnPayload {
  subscriptionId: string;
  amount: number;
  date: string;
  financialAccountId?: string;
  referenceNumber?: string;
  notes?: string;
}

const basePath = "/capital-returns";

export const capitalReturnsService = {
  list: (
    params: {
      investorId?: string;
      subscriptionId?: string;
      opportunityId?: string;
      status?: CapitalReturnStatus[];
      page?: number;
      pageSize?: number;
    } = {},
  ) =>
    apiClient.get<{
      items: CapitalReturnRow[];
      total: number;
      page: number;
      pageSize: number;
    }>(`${basePath}${buildQueryString(params)}`),
  get: (id: string) => apiClient.get<CapitalReturnRow>(`${basePath}/${id}`),
  create: (dto: CreateCapitalReturnPayload) => apiClient.post<CapitalReturnRow>(basePath, dto),
  approve: (id: string) => apiClient.post<CapitalReturnRow>(`${basePath}/${id}/approve`),
  pay: (id: string) => apiClient.post<CapitalReturnRow>(`${basePath}/${id}/pay`),
  cancel: (id: string) => apiClient.post<CapitalReturnRow>(`${basePath}/${id}/cancel`),
  activity: (id: string) => apiClient.get<MasterDataActivityEntry[]>(`${basePath}/${id}/activity`),
};
