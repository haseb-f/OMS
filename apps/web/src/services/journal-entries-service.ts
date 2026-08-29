import { apiClient } from "./api-client";
import { buildQueryString } from "@/lib/query-string";

export type JournalEntryStatusValue = "DRAFT" | "POSTED" | "REVERSED";

export interface JournalEntryLineRow {
  id: string;
  journalEntryId: string;
  accountId: string;
  account?: { id: string; code: string; name: string } | null;
  description: string | null;
  costCenterId: string | null;
  costCenter?: { id: string; code: string; name: string } | null;
  projectId: string | null;
  project?: { id: string; code: string; name: string } | null;
  /** Unified Partner Architecture — required whenever `account` is a RECEIVABLE/PAYABLE control account (backend-enforced). */
  partnerId: string | null;
  partner?: { id: string; partnerNumber: string; name: string } | null;
  debit: string;
  credit: string;
  lineOrder: number;
}

export interface JournalEntryRow {
  id: string;
  entryNumber: string;
  entryDate: string;
  description: string | null;
  status: JournalEntryStatusValue;
  totalDebit: string;
  totalCredit: string;
  sourceType: string | null;
  sourceId: string | null;
  journalId: string | null;
  journal?: { id: string; code: string; name: string; type: string } | null;
  currencyId: string | null;
  currency?: { id: string; code: string; name: string } | null;
  referenceNumber: string | null;
  reversalOfEntryId: string | null;
  reversalOfEntry?: { id: string; entryNumber: string } | null;
  reversedByEntry?: { id: string; entryNumber: string } | null;
  postedAt: string | null;
  postedBy: string | null;
  reversedAt: string | null;
  reversedBy: string | null;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
  updatedBy: string | null;
  deletedAt: string | null;
  lines: JournalEntryLineRow[];
}

export interface JournalEntryLineInputPayload {
  accountId: string;
  description?: string;
  costCenterId?: string;
  projectId?: string;
  partnerId?: string;
  debit?: number;
  credit?: number;
}

export interface JournalEntryFormPayload {
  entryDate?: string;
  description?: string;
  journalId?: string;
  currencyId?: string;
  referenceNumber?: string;
  lines: JournalEntryLineInputPayload[];
}

export interface JournalEntryTemplateRow {
  id: string;
  name: string;
  description: string | null;
  journalId: string | null;
  journal?: { id: string; code: string; name: string } | null;
  lines: JournalEntryLineInputPayload[];
  createdAt: string;
  createdBy: string | null;
}

export interface SaveJournalEntryTemplatePayload {
  name: string;
  description?: string;
  journalId?: string;
  lines: JournalEntryLineInputPayload[];
}

export interface JournalEntryListParams {
  search?: string;
  status?: JournalEntryStatusValue | JournalEntryStatusValue[];
  journalId?: string | string[];
  /** TASK-054 — Journal ↔ Source Document lookup (both required together). */
  sourceType?: string;
  sourceId?: string;
  dateFrom?: string;
  dateTo?: string;
  page?: number;
  pageSize?: number;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
}

export interface JournalEntryListResult {
  items: JournalEntryRow[];
  total: number;
  page: number;
  pageSize: number;
}

export interface JournalEntryIdsResult {
  ids: string[];
  total: number;
}

export interface JournalEntryBulkArchiveResult {
  succeeded: string[];
  failed: { id: string; message: string }[];
}

export interface JournalEntryActivityEntry {
  id: string;
  type: string;
  description: string;
  metadata: unknown;
  createdAt: string;
  createdBy: string | null;
}

/**
 * Accounting Foundation (TASK-044 Part 6) — Manual Journal Entry client.
 * Infrastructure only: no auto-posting from any other module calls this.
 */
export const journalEntriesService = {
  list: (params: JournalEntryListParams = {}) =>
    apiClient.get<JournalEntryListResult>(
      `/journal-entries${buildQueryString(params as Record<string, unknown>)}`,
    ),
  /** "Select all matching filters" (Part 8) — same params as `list`, bare IDs only. */
  listIds: (params: JournalEntryListParams = {}) =>
    apiClient.get<JournalEntryIdsResult>(
      `/journal-entries/ids${buildQueryString(params as Record<string, unknown>)}`,
    ),
  get: (id: string) => apiClient.get<JournalEntryRow>(`/journal-entries/${id}`),
  create: (dto: JournalEntryFormPayload) =>
    apiClient.post<JournalEntryRow>("/journal-entries", dto),
  update: (id: string, dto: Partial<JournalEntryFormPayload>) =>
    apiClient.patch<JournalEntryRow>(`/journal-entries/${id}`, dto),
  post: (id: string) => apiClient.post<JournalEntryRow>(`/journal-entries/${id}/post`),
  reverse: (id: string) => apiClient.post<JournalEntryRow>(`/journal-entries/${id}/reverse`),
  /** Soft-delete — Draft only (enforced server-side). A Posted entry is permanent ledger history; use Reverse instead. */
  archive: (id: string) => apiClient.post<JournalEntryRow>(`/journal-entries/${id}/archive`),
  /** One controlled server-side call instead of fanning out N concurrent archive requests for a large/cross-page selection. */
  bulkArchive: (ids: string[]) =>
    apiClient.post<JournalEntryBulkArchiveResult>(`/journal-entries/bulk-archive`, { ids }),
  /** Hard delete — Draft only (enforced server-side). Once Posted, use Archive/Reverse instead. */
  remove: (id: string) => apiClient.delete<void>(`/journal-entries/${id}`),
  /** Creates a new Draft copying this entry's journal/description/lines — never its number, status, or posted/reversed audit fields. */
  duplicate: (id: string) => apiClient.post<JournalEntryRow>(`/journal-entries/${id}/duplicate`),
  activities: (id: string) =>
    apiClient.get<JournalEntryActivityEntry[]>(`/journal-entries/${id}/activities`),
  /** "Recurring Journal Templates" — a saved starting point applied via "New from Template," never an automatic scheduler. */
  templates: {
    list: () => apiClient.get<JournalEntryTemplateRow[]>("/journal-entries/templates"),
    save: (dto: SaveJournalEntryTemplatePayload) =>
      apiClient.post<JournalEntryTemplateRow>("/journal-entries/templates", dto),
    remove: (id: string) => apiClient.delete<void>(`/journal-entries/templates/${id}`),
  },
};
