import { apiClient } from "./api-client";
import { buildQueryString } from "@/lib/query-string";
import type { MasterDataActivityEntry } from "./master-data-service";

export type DistributionPaymentStatus = "PENDING" | "CONFIRMED" | "REJECTED" | "CANCELLED";

export interface DistributionPaymentRow {
  id: string;
  investorDistributionId: string;
  investorName: string;
  amount: number;
  paymentDate: string;
  financialAccount: { id: string; code: string; name: string } | null;
  paymentMethod: { id: string; name: string } | null;
  referenceNumber: string | null;
  status: DistributionPaymentStatus;
  createdBy: string | null;
  confirmedBy: string | null;
  confirmedAt: string | null;
  notes: string | null;
  createdAt: string;
}

export interface CreateDistributionPaymentPayload {
  investorDistributionId: string;
  amount: number;
  paymentDate: string;
  financialAccountId: string;
  paymentMethodId?: string;
  referenceNumber?: string;
  notes?: string;
}

const basePath = "/investment-payments";

export const distributionPaymentsService = {
  list: (
    params: {
      investorDistributionId?: string;
      status?: DistributionPaymentStatus[];
      page?: number;
      pageSize?: number;
    } = {},
  ) =>
    apiClient.get<{
      items: DistributionPaymentRow[];
      total: number;
      page: number;
      pageSize: number;
    }>(`${basePath}${buildQueryString(params)}`),
  get: (id: string) => apiClient.get<DistributionPaymentRow>(`${basePath}/${id}`),
  create: (dto: CreateDistributionPaymentPayload) =>
    apiClient.post<DistributionPaymentRow>(basePath, dto),
  confirm: (id: string) => apiClient.post<DistributionPaymentRow>(`${basePath}/${id}/confirm`),
  reject: (id: string, reason?: string) =>
    apiClient.post<DistributionPaymentRow>(`${basePath}/${id}/reject`, { reason }),
  cancel: (id: string) => apiClient.post<DistributionPaymentRow>(`${basePath}/${id}/cancel`),
  activity: (id: string) => apiClient.get<MasterDataActivityEntry[]>(`${basePath}/${id}/activity`),
};
