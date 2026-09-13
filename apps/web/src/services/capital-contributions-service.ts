import { apiClient } from "./api-client";
import { buildQueryString } from "@/lib/query-string";
import type { MasterDataActivityEntry } from "./master-data-service";

export type CapitalContributionStatus = "PENDING" | "CONFIRMED" | "REJECTED" | "CANCELLED";

export interface CapitalContributionRow {
  id: string;
  subscriptionId: string;
  investorName: string;
  opportunityId: string;
  opportunityCode: string;
  amount: number;
  contributionDate: string;
  paymentMethod: { id: string; name: string } | null;
  referenceNumber: string | null;
  status: CapitalContributionStatus;
  confirmedBy: string | null;
  confirmedAt: string | null;
  notes: string | null;
  createdAt: string;
}

export interface CreateCapitalContributionPayload {
  subscriptionId: string;
  amount: number;
  contributionDate: string;
  paymentMethodId?: string;
  financialAccountId?: string;
  referenceNumber?: string;
  notes?: string;
}

export interface ContributionAttachmentRow {
  id: string;
  attachmentId: string | null;
  fileName: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  fileUrl: string;
  attachmentType: string;
  uploadedBy: string | null;
  createdAt: string;
}

const basePath = "/capital-contributions";

export const capitalContributionsService = {
  list: (
    params: {
      subscriptionId?: string;
      opportunityId?: string;
      investorId?: string;
      status?: CapitalContributionStatus[];
      page?: number;
      pageSize?: number;
    } = {},
  ) =>
    apiClient.get<{
      items: CapitalContributionRow[];
      total: number;
      page: number;
      pageSize: number;
    }>(`${basePath}${buildQueryString(params)}`),
  get: (id: string) => apiClient.get<CapitalContributionRow>(`${basePath}/${id}`),
  create: (dto: CreateCapitalContributionPayload) =>
    apiClient.post<CapitalContributionRow>(basePath, dto),
  confirm: (id: string) => apiClient.post<CapitalContributionRow>(`${basePath}/${id}/confirm`),
  reject: (id: string, reason?: string) =>
    apiClient.post<CapitalContributionRow>(`${basePath}/${id}/reject`, { reason }),
  cancel: (id: string) => apiClient.post<CapitalContributionRow>(`${basePath}/${id}/cancel`),
  activity: (id: string) => apiClient.get<MasterDataActivityEntry[]>(`${basePath}/${id}/activity`),
  attachStaging: (id: string, stagingAttachmentIds: string[]) =>
    apiClient.post<ContributionAttachmentRow[]>(`${basePath}/${id}/attachments/from-staging`, {
      stagingAttachmentIds,
    }),
  listAttachments: (id: string) =>
    apiClient.get<ContributionAttachmentRow[]>(`${basePath}/${id}/attachments`),
};
