import { apiClient } from "./api-client";

export type WorkflowTypeValue =
  "LEAD" | "ORDER" | "PAYMENT" | "FULFILLMENT" | "MATCHING" | "RECONCILIATION";

export interface WorkflowAction {
  transitionId: string;
  label: string;
  labelEn: string | null;
  toStatusCode: string;
  toStatusName: string;
  color: string;
  requiresReason: boolean;
  requiresApproval: boolean;
  isPrimary: boolean;
  businessAction: string;
}

export interface StatusHistoryRow {
  id: string;
  changedAt: string;
  reason: string | null;
  source: string;
  fromStatus: { code: string; name: string; color: string } | null;
  toStatus: { code: string; name: string; color: string };
  changedBy: { id: string; fullName: string } | null;
  transition: { labelAr: string } | null;
}

export interface LeadConvertPayload {
  productId?: string;
  quantity?: number;
  unitPrice?: number;
  paymentType?: "PREPAID" | "CASH_ON_DELIVERY";
  paymentSourceId?: string;
  notes?: string;
}

export const workflowService = {
  availableActions: (entityType: string, entityId: string) =>
    apiClient.get<WorkflowAction[]>(`/workflow/${entityType}/${entityId}/available-actions`),

  transition: (
    entityType: string,
    entityId: string,
    body: {
      transitionId: string;
      reason?: string;
      productId?: string;
      quantity?: number;
      unitPrice?: number;
      paymentType?: string;
    },
  ) => apiClient.post(`/workflow/${entityType}/${entityId}/transition`, body),

  statusHistory: (entityType: string, entityId: string) =>
    apiClient.get<StatusHistoryRow[]>(`/workflow/${entityType}/${entityId}/status-history`),

  approve: (approvalId: string) => apiClient.post(`/workflow/approvals/${approvalId}/approve`),

  reject: (approvalId: string, reason?: string) =>
    apiClient.post(`/workflow/approvals/${approvalId}/reject`, { reason }),

  listTransitions: (workflowType?: WorkflowTypeValue) =>
    apiClient.get(`/workflow/transitions${workflowType ? `?workflowType=${workflowType}` : ""}`),

  createTransition: (body: Record<string, unknown>) =>
    apiClient.post(`/workflow/transitions`, body),

  updateTransition: (id: string, body: Record<string, unknown>) =>
    apiClient.patch(`/workflow/transitions/${id}`, body),

  pendingApprovals: () => apiClient.get(`/workflow/approvals/pending`),

  leadFunnel: (params?: {
    dateFrom?: string;
    dateTo?: string;
    source?: string;
    salesEmployeeId?: string;
  }) => {
    const q = new URLSearchParams();
    if (params?.dateFrom) q.set("dateFrom", params.dateFrom);
    if (params?.dateTo) q.set("dateTo", params.dateTo);
    if (params?.source) q.set("source", params.source);
    if (params?.salesEmployeeId) q.set("salesEmployeeId", params.salesEmployeeId);
    const qs = q.toString();
    return apiClient.get(`/workflow/analytics/lead-funnel${qs ? `?${qs}` : ""}`);
  },
};
