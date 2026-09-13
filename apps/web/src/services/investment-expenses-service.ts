import { apiClient } from "./api-client";
import { buildQueryString } from "@/lib/query-string";
import type { MasterDataActivityEntry } from "./master-data-service";

export type OpportunityExpenseCategory =
  "ADVERTISING" | "SHIPPING" | "STORAGE" | "PAYMENT_FEES" | "RETURNS" | "OTHER";
export type OpportunityExpenseStatus = "DRAFT" | "APPROVED" | "REJECTED" | "VOIDED";

export interface OpportunityExpenseRow {
  id: string;
  opportunityId: string;
  expenseDate: string;
  category: OpportunityExpenseCategory;
  description: string;
  amount: number;
  status: OpportunityExpenseStatus;
  sourceExpenseId: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  notes: string | null;
  attachmentCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateOpportunityExpensePayload {
  opportunityId: string;
  expenseDate: string;
  category: OpportunityExpenseCategory;
  description: string;
  amount: number;
  sourceExpenseId?: string;
  notes?: string;
}

export type UpdateOpportunityExpensePayload = Partial<
  Omit<CreateOpportunityExpensePayload, "opportunityId">
>;

const basePath = "/investment-expenses";

export const investmentExpensesService = {
  list: (params: {
    opportunityId: string;
    status?: OpportunityExpenseStatus;
    page?: number;
    pageSize?: number;
  }) =>
    apiClient.get<{
      items: OpportunityExpenseRow[];
      total: number;
      page: number;
      pageSize: number;
    }>(`${basePath}${buildQueryString(params)}`),
  get: (id: string) => apiClient.get<OpportunityExpenseRow>(`${basePath}/${id}`),
  create: (dto: CreateOpportunityExpensePayload) =>
    apiClient.post<OpportunityExpenseRow>(basePath, dto),
  update: (id: string, dto: UpdateOpportunityExpensePayload) =>
    apiClient.patch<OpportunityExpenseRow>(`${basePath}/${id}`, dto),
  approve: (id: string) => apiClient.post<OpportunityExpenseRow>(`${basePath}/${id}/approve`),
  reject: (id: string) => apiClient.post<OpportunityExpenseRow>(`${basePath}/${id}/reject`),
  void: (id: string) => apiClient.post<OpportunityExpenseRow>(`${basePath}/${id}/void`),
  activity: (id: string) => apiClient.get<MasterDataActivityEntry[]>(`${basePath}/${id}/activity`),
};
