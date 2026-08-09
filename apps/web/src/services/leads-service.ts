import { apiClient } from "./api-client";
import { createMasterDataService } from "./master-data-service";

export type LeadStatusValue = "NEW" | "UNDER_FOLLOW_UP" | "PAID" | "ARCHIVED";
export type LeadSourceValue = "MANUAL" | "EXCEL" | "GOOGLE_SHEETS";

export interface LeadRow {
  id: string;
  leadNumber: string;
  customerName: string;
  mobileNumber: string;
  countryId: string;
  country: { id: string; name: string } | null;
  city: string;
  address: string;
  productId: string | null;
  quantity: number;
  currencyId: string;
  currency: { id: string; code: string; name: string } | null;
  salesEmployeeId: string | null;
  salesEmployee: { id: string; fullName: string; email: string } | null;
  assignedAt: string | null;
  status: LeadStatusValue;
  source: LeadSourceValue;
  archivedReason: string | null;
  possibleDuplicate: boolean;
  importBatch: string | null;
  externalOrderId: string | null;
  customerId: string | null;
  customer: { id: string; customerNumber: string; name: string } | null;
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

// Single type param — `create`/`update` stay structurally compatible with
// `MasterDataPage`'s loosely-typed `Record<string, unknown>` form values,
// same convention `customersService` uses.
const base = createMasterDataService<LeadRow>("/leads");

/**
 * The one Leads/Orders API client (TASK-061). Reuses `createMasterDataService`
 * for list/get/create/update (the generic archive/restore aren't used here —
 * see `MasterDataPage`'s `disableArchiveRestore`, since Lead's "Archive" is a
 * business-status transition, not soft-delete). Every business operation
 * below is a distinct existing endpoint, never a second write path.
 */
export const leadsService = {
  ...base,
  /** Lead's timeline lives at `/leads/:id/activities` (its own `LeadActivity` table), not the generic Master Data activity log `createMasterDataService.activity` assumes. */
  activities: (id: string) => apiClient.get<LeadActivityRow[]>(`/leads/${id}/activities`),
  assignments: (id: string) => apiClient.get<LeadAssignmentRow[]>(`/leads/${id}/assignments`),
  notes: (id: string) => apiClient.get<LeadNoteRow[]>(`/leads/${id}/notes`),
  addNote: (id: string, text: string) =>
    apiClient.post<LeadNoteRow>(`/leads/${id}/notes`, { text }),
  assign: (id: string, salesEmployeeId: string) =>
    apiClient.post<LeadAssignmentRow>(`/leads/${id}/assign`, { salesEmployeeId }),
  bulkAssign: (leadIds: string[], salesEmployeeId?: string) =>
    apiClient.post<{ assigned: number }>("/leads/bulk-assign", { leadIds, salesEmployeeId }),
  /** Active users granted `crm.leads.edit` — the only valid Assign-dialog choices (server re-validates regardless). */
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
