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
  assignedToId: string;
  assignedAt: string;
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
  assign: (id: string, salesEmployeeId: string) =>
    apiClient.post<LeadAssignmentRow>(`/leads/${id}/assign`, { salesEmployeeId }),
  bulkAssign: (leadIds: string[], salesEmployeeId?: string) =>
    apiClient.post<{ assigned: number }>("/leads/bulk-assign", { leadIds, salesEmployeeId }),
  eligibleAssignees: () =>
    apiClient.get<{ id: string; fullName: string; email: string }[]>("/leads/eligible-assignees"),
  startFollowUp: (id: string) => apiClient.post<LeadRow>(`/leads/${id}/start-follow-up`),
  markPaid: (id: string) => apiClient.post<LeadRow>(`/leads/${id}/mark-paid`),
  archiveLead: (id: string, archiveReason?: string) =>
    apiClient.post<LeadRow>(`/leads/${id}/archive`, { archiveReason }),
  convertToCustomer: (id: string) =>
    apiClient.post<{ lead: LeadRow; customer: unknown; created: boolean }>(
      `/leads/${id}/convert-to-customer`,
    ),
};
