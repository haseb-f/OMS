import { apiClient } from "./api-client";

export type FiscalYearStatusValue = "OPEN" | "CLOSED";
export type AccountingPeriodStatusValue = "OPEN" | "CLOSED" | "LOCKED";

export interface AccountingPeriodRow {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  status: AccountingPeriodStatusValue;
  fiscalYearId: string;
  closedAt: string | null;
  closedBy: string | null;
  lockedAt: string | null;
  lockedBy: string | null;
}

export interface FiscalYearRow {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  status: FiscalYearStatusValue;
  isDefault: boolean;
  companyId: string | null;
  periods: AccountingPeriodRow[];
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface BulkPeriodActionResult {
  succeeded: number;
  failed: { id: string; message: string }[];
}

export interface CreateFiscalYearPayload {
  name: string;
  startDate: string;
  endDate: string;
  companyId?: string;
}

/**
 * TASK-051 Phase 2 — Fiscal Years & Accounting Periods. Creating a Fiscal
 * Year auto-generates its monthly periods server-side; there is no
 * "create period" call here by design (UX Policy — never a manual
 * document/period-numbering step).
 */
export const fiscalYearsService = {
  list: () => apiClient.get<FiscalYearRow[]>("/accounting/fiscal-years"),
  get: (id: string) => apiClient.get<FiscalYearRow>(`/accounting/fiscal-years/${id}`),
  create: (dto: CreateFiscalYearPayload) =>
    apiClient.post<FiscalYearRow>("/accounting/fiscal-years", dto),
  close: (id: string) => apiClient.post<FiscalYearRow>(`/accounting/fiscal-years/${id}/close`),
  reopen: (id: string) => apiClient.post<FiscalYearRow>(`/accounting/fiscal-years/${id}/reopen`),
  /** Soft-delete — same convention as every other reference entity. */
  archive: (id: string) => apiClient.post<FiscalYearRow>(`/accounting/fiscal-years/${id}/archive`),
  setDefault: (id: string) =>
    apiClient.post<FiscalYearRow>(`/accounting/fiscal-years/${id}/set-default`),
};

export const accountingPeriodsService = {
  close: (id: string) => apiClient.post<AccountingPeriodRow>(`/accounting/periods/${id}/close`),
  reopen: (id: string) => apiClient.post<AccountingPeriodRow>(`/accounting/periods/${id}/reopen`),
  lock: (id: string) => apiClient.post<AccountingPeriodRow>(`/accounting/periods/${id}/lock`),
  unlock: (id: string) => apiClient.post<AccountingPeriodRow>(`/accounting/periods/${id}/unlock`),
  bulkClose: (ids: string[]) =>
    apiClient.post<BulkPeriodActionResult>("/accounting/periods/bulk-close", { ids }),
  bulkOpen: (ids: string[]) =>
    apiClient.post<BulkPeriodActionResult>("/accounting/periods/bulk-open", { ids }),
};
