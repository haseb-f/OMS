import { apiClient } from "./api-client";
import { createMasterDataService } from "./master-data-service";

export type LeadSourceValue = "MANUAL" | "EXCEL" | "GOOGLE_SHEETS";

export interface LeadStatusSnapshot {
  id: string;
  code: string;
  name: string;
  nameEn: string | null;
  color: string;
  isFinal: boolean;
}

export interface LeadRow {
  id: string;
  leadNumber: string;
  customerName: string;
  mobileNumber: string;
  countryId: string;
  country: { id: string; name: string } | null;
  city: string | null;
  address: string | null;
  productId: string | null;
  product: { id: string; name: string; displayName: string; sku: string } | null;
  quantity: number;
  currencyId: string;
  currency: { id: string; code: string; name: string } | null;
  salesEmployeeId: string | null;
  salesEmployee: { id: string; fullName: string; email: string } | null;
  assignedAt: string | null;
  statusId: string;
  status: LeadStatusSnapshot;
  source: LeadSourceValue;
  archivedReason: string | null;
  possibleDuplicate: boolean;
  importBatch: string | null;
  externalOrderId: string | null;
  partnerId: string | null;
  partner: { id: string; partnerNumber: string; name: string } | null;
  storeOrder: { id: string; internalOrderId: string } | null;
  nextFollowUpAt: string | null;
  firstOpenedAt: string | null;
  customerClassificationId: string | null;
  customerClassification: {
    id: string;
    code: string;
    name: string;
    nameEn: string | null;
    color: string;
    isActive: boolean;
    deletedAt: string | null;
  } | null;
  noPurchaseReasonId: string | null;
  noPurchaseReason: {
    id: string;
    code: string;
    name: string;
    nameEn: string | null;
  } | null;
  closeNotes: string | null;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
  updatedBy: string | null;
  deletedAt: string | null;
}

export interface LeadFormPayload {
  customerName: string;
  mobileNumber: string;
  countryId: string;
  city: string;
  address: string;
  quantity: number;
  currencyId: string;
  externalOrderId?: string;
  salesEmployeeId?: string;
}

export interface LeadActivityRow {
  id: string;
  leadId: string;
  type: string;
  description: string;
  metadata: unknown;
  createdAt: string;
}

export interface LeadAssignmentRow {
  id: string;
  leadId: string;
  fromUserId: string | null;
  assignedToId: string;
  method: string;
  reason: string | null;
  actorId: string | null;
  assignedAt: string;
  assignedTo?: { id: string; fullName: string };
  fromUser?: { id: string; fullName: string } | null;
}

export interface LeadFollowUpRow {
  id: string;
  leadId: string;
  userId: string;
  outcome: string | null;
  note: string | null;
  followUpAt: string | null;
  completedAt: string | null;
  createdAt: string;
  user?: { id: string; fullName: string };
}

export interface LeadDistributionSnapshot {
  policy: {
    id: string;
    mode: "CONTINUOUS" | "TIME_LIMITED";
    isActive: boolean;
    startedAt: string;
    expiresAt: string | null;
    remainingMs: number | null;
    teamId: string | null;
  } | null;
  eligible: { id: string; fullName: string; email: string }[];
}

export interface LeadNoteRow {
  id: string;
  leadId: string;
  userId: string;
  text: string;
  createdAt: string;
}

const base = createMasterDataService<LeadRow>("/leads");

export const leadsService = {
  ...base,
  activities: (id: string) => apiClient.get<LeadActivityRow[]>(`/leads/${id}/activities`),
  assignments: (id: string) => apiClient.get<LeadAssignmentRow[]>(`/leads/${id}/assignments`),
  notes: (id: string) => apiClient.get<LeadNoteRow[]>(`/leads/${id}/notes`),
  addNote: (id: string, text: string) =>
    apiClient.post<LeadNoteRow>(`/leads/${id}/notes`, { text }),
  assign: (id: string, salesEmployeeId: string, reason?: string) =>
    apiClient.post<LeadAssignmentRow>(`/leads/${id}/assign`, { salesEmployeeId, reason }),
  bulkAssign: (body: {
    leadIds?: string[];
    salesEmployeeId: string;
    reason?: string;
    count?: number;
    unassignedOnly?: boolean;
    countryId?: string;
    statusCode?: string;
    source?: LeadSourceValue;
    dryRun?: boolean;
  }) =>
    apiClient.post<{ assigned: number; ids: string[]; preview?: boolean }>(
      "/leads/bulk-assign",
      body,
    ),
  eligibleAssignees: () =>
    apiClient.get<{ id: string; fullName: string; email: string }[]>("/leads/eligible-assignees"),
  distribution: () => apiClient.get<LeadDistributionSnapshot>("/leads/distribution"),
  activateContinuous: () => apiClient.post("/leads/distribution/activate-continuous"),
  activate24h: () => apiClient.post("/leads/distribution/activate-24h"),
  deactivateDistribution: () => apiClient.post("/leads/distribution/deactivate"),
  firstOpen: (id: string) => apiClient.post<LeadRow>(`/leads/${id}/first-open`),
  followUps: (id: string) => apiClient.get<LeadFollowUpRow[]>(`/leads/${id}/follow-ups`),
  addFollowUp: (
    id: string,
    body: { outcome?: string; note?: string; followUpAt?: string; channel?: string },
  ) => apiClient.post<LeadFollowUpRow>(`/leads/${id}/follow-ups`, body),
  unassignedCount: () => apiClient.get<{ count: number }>("/leads/unassigned-count"),
  startFollowUp: (id: string) => apiClient.post<LeadRow>(`/leads/${id}/start-follow-up`),
  archiveLead: (id: string, archiveReason?: string) =>
    apiClient.post<LeadRow>(`/leads/${id}/archive`, { archiveReason }),
  convert: (id: string, body: Record<string, unknown>) =>
    apiClient.post<LeadRow>(`/leads/${id}/convert`, body),
  closeWithoutPurchase: (id: string, body: { noPurchaseReasonId: string; notes?: string }) =>
    apiClient.post<LeadRow>(`/leads/${id}/close-without-purchase`, body),
  scope: () =>
    apiClient.get<{ kind: string; canAssign: boolean; canManage: boolean }>("/leads/scope"),
};
