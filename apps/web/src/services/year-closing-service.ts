import { apiClient } from "./api-client";
import type { JournalEntryRow } from "./journal-entries-service";

export interface CloseYearPayload {
  fiscalYearId: string;
}

export interface CloseYearResult {
  closingEntry: JournalEntryRow;
  /** True when the year was already closed — the request returned the existing entry and posted nothing. */
  alreadyClosed: boolean;
}

export interface YearClosingEntrySummary {
  id: string;
  entryNumber: string;
  entryDate: string;
  status: JournalEntryRow["status"];
  totalDebit: string;
  reversalOfEntryId: string | null;
}

export interface YearClosingStatus {
  fiscalYear: { id: string; name: string; startDate: string; endDate: string; status: string };
  activeClosing: YearClosingEntrySummary | null;
  /** Every closing, reversal and re-closing of this year, oldest first. */
  history: YearClosingEntrySummary[];
  blockers: { code: string; message: string }[];
  canClose: boolean;
  canReverse: boolean;
  nextFiscalYear: { id: string; name: string; startDate: string; endDate: string } | null;
}

export interface DerivedOpeningBalances {
  fiscalYear: { id: string; name: string; startDate: string; status: string };
  basis: "LEDGER" | "OPENING_ENTRY" | "LEDGER_AND_OPENING_ENTRY" | "NONE";
  openingEntry: { id: string; entryNumber: string } | null;
  accounts: {
    accountId: string;
    accountCode: string;
    accountName: string;
    accountType: string;
    openingBalance: number;
  }[];
  totals: { debit: number; credit: number; difference: number };
  /** Sum of absolute Revenue/Expense opening balances — 0 once the previous year is closed. */
  profitAndLossOpening: number;
}

/**
 * Year Closing (TASK-055 Part 5) — distinct from Fiscal Years' plain Close
 * (status flip only): posts the closing entry (P&L → Retained Earnings)
 * through the Posting Engine. The next year's opening balances are derived
 * from the ledger, never posted (`derivedOpening`).
 */
export const yearClosingService = {
  execute: (dto: CloseYearPayload) =>
    apiClient.post<CloseYearResult>("/accounting/year-closing", dto),
  status: (fiscalYearId: string) =>
    apiClient.get<YearClosingStatus>(`/accounting/year-closing/${fiscalYearId}`),
  reverse: (fiscalYearId: string, reason: string) =>
    apiClient.post<{ reversal: JournalEntryRow; original: JournalEntryRow }>(
      `/accounting/year-closing/${fiscalYearId}/reverse`,
      { reason },
    ),
  derivedOpening: (fiscalYearId: string) =>
    apiClient.get<DerivedOpeningBalances>(
      `/accounting/opening-balances/fiscal-years/${fiscalYearId}`,
    ),
};
