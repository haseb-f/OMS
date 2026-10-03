import { apiClient } from "./api-client";
import { createMasterDataService } from "./master-data-service";
import type { LeadFollowUpOutcome } from "@/config/crm/follow-up-outcomes";

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
  /**
   * R7 - whether THIS employee has opened the lead (per-user read state, list
   * rows only). Not a business status: it never reflects contacted/followed-up.
   */
  viewedByMe?: boolean;
  /** R6 — current follow-up classification (latest outcome code); null until one is recorded. */
  followUpOutcome: string | null;
  followUpOutcomeAt: string | null;
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
  followUpTypeId: string | null;
  followUpType: { id: string; name: string; nameEn: string | null } | null;
  outcome: string | null;
  note: string | null;
  followUpAt: string | null;
  completedAt: string | null;
  createdAt: string;
  user?: { id: string; fullName: string };
}

/** Why a user is not a lead recipient (server-side shared eligibility rules). */
export type LeadExclusionReason =
  | "AGENT_USER"
  | "DELETED"
  | "INACTIVE"
  | "LOCKED"
  | "ON_LEAVE"
  | "TERMINATED"
  | "NO_PERMISSION"
  | "NOT_SALES_DESIGNATED"
  | "WRONG_TEAM"
  | "WRONG_DEPARTMENT";

export interface LeadExcludedUser {
  id: string;
  fullName: string;
  email: string;
  reason: LeadExclusionReason;
  reasons: LeadExclusionReason[];
}

export interface LeadDistributionSnapshot {
  status?: "CONTINUOUS" | "TIME_LIMITED" | "MANUAL" | "PAUSED";
  isRunning?: boolean;
  policy: {
    id: string;
    mode: "CONTINUOUS" | "TIME_LIMITED" | "MANUAL" | "PAUSED";
    isActive: boolean;
    startedAt: string;
    expiresAt: string | null;
    remainingMs: number | null;
    teamId: string | null;
    departmentId?: string | null;
  } | null;
  eligible: { id: string; fullName: string; email: string }[];
  /** R7 — considered users who do NOT qualify as recipients, each with why. */
  excluded?: LeadExcludedUser[];
  excludedTruncated?: boolean;
  /** Size of the Round Robin pool the next drain would use. */
  eligibleCount?: number;
  /** Team the policy is scoped to; null = whole company. */
  team?: { id: string; name: string } | null;
  pendingEligibleCount?: number;
  failureReason?: string | null;
  /** NO_ELIGIBLE_EMPLOYEES (blocked), PENDING_NOT_AUTO (paused backlog) or a last-run code. */
  failureCode?: string | null;
  lastRun?: {
    at: string | null;
    assigned: number;
    failureCode: string | null;
    failureMessage: string | null;
  } | null;
  held?: {
    count: number;
    batches: { importBatch: string | null; count: number; createdAt: string | null }[];
  };
}

/** Server-confirmed outcome of the drain an activate call ran. */
export interface LeadDistributionRun {
  assigned: number;
  skipped: number;
  failureCode: string | null;
  failureReason: string | null;
  alreadyRunning?: boolean;
}

/** Activate responses: the fresh snapshot plus the drain it ran. */
export interface LeadDistributionActivateResult extends LeadDistributionSnapshot {
  run?: LeadDistributionRun | null;
  reused?: boolean;
}

export interface LeadNoteRow {
  id: string;
  leadId: string;
  userId: string;
  text: string;
  createdAt: string;
}

/** Team / department a distribution policy applies to (null = company-wide). */
export interface DistributionScope {
  teamId?: string | null;
  departmentId?: string | null;
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
  /** `scope` omitted = keep the active policy's scope; null = company-wide. */
  activateContinuous: (scope?: DistributionScope) =>
    apiClient.post<LeadDistributionActivateResult>(
      "/leads/distribution/activate-continuous",
      scope ?? {},
    ),
  activate24h: (scope?: DistributionScope) =>
    apiClient.post<LeadDistributionActivateResult>("/leads/distribution/activate-24h", scope ?? {}),
  activateManual: () =>
    apiClient.post<LeadDistributionSnapshot>("/leads/distribution/activate-manual"),
  pauseDistribution: () => apiClient.post<LeadDistributionSnapshot>("/leads/distribution/pause"),
  deactivateDistribution: () =>
    apiClient.post<LeadDistributionSnapshot>("/leads/distribution/deactivate"),
  releaseHeld: (body: {
    importBatch?: string | null;
    mode?: "CONTINUOUS" | "TIME_LIMITED" | "MANUAL";
    salesEmployeeId?: string;
  }) =>
    apiClient.post<{ released: number; ids: string[] }>("/leads/distribution/release-held", body),
  /** Records that the caller opened the lead - idempotent, read state only (never changes status). */
  markViewed: (id: string) =>
    apiClient.post<{ leadId: string; viewedByMe: true }>(`/leads/${id}/viewed`),
  firstOpen: (id: string) => apiClient.post<LeadRow>(`/leads/${id}/first-open`),
  followUps: (id: string) => apiClient.get<LeadFollowUpRow[]>(`/leads/${id}/follow-ups`),
  addFollowUp: (
    id: string,
    body: {
      followUpTypeId?: string;
      outcome?: LeadFollowUpOutcome;
      note?: string;
      followUpAt?: string;
    },
  ) => apiClient.post<LeadFollowUpRow>(`/leads/${id}/follow-ups`, body),
  unassignedCount: () => apiClient.get<{ count: number }>("/leads/unassigned-count"),
  convert: (id: string, body: Record<string, unknown>) =>
    apiClient.post<LeadRow>(`/leads/${id}/convert`, body),
  closeWithoutPurchase: (id: string, body: { noPurchaseReasonId: string; notes?: string }) =>
    apiClient.post<LeadRow>(`/leads/${id}/close-without-purchase`, body),
  scope: () =>
    apiClient.get<{ kind: string; canAssign: boolean; canManage: boolean }>("/leads/scope"),
  /** Smart Selection (Bulk Ops) — mixed-status batches are expected; partial success is reported, never all-or-nothing. */
  bulkChangeStatus: (body: { leadIds: string[]; statusCode: string; reason?: string }) =>
    apiClient.post<{ succeeded: string[]; failed: { id: string; message: string }[] }>(
      "/leads/bulk-status",
      body,
    ),
};
