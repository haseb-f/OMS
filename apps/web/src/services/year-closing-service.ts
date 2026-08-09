import { apiClient } from "./api-client";
import type { JournalEntryRow } from "./journal-entries-service";

export interface CloseYearPayload {
  fiscalYearId: string;
  nextFiscalYearId?: string;
}

export interface CloseYearResult {
  closingEntry: JournalEntryRow;
  openingEntry: JournalEntryRow | null;
}

/**
 * Year Closing (TASK-055 Part 5) — distinct from Fiscal Years' plain Close
 * (status flip only); this runs the actual accounting ceremony (P&L
 * transfer to Retained Earnings, optional next-year Opening Entry) via the
 * existing Journal/Posting infrastructure. The Fiscal Year must already be
 * Closed (Finance > Fiscal Years) before this can run.
 */
export const yearClosingService = {
  execute: (dto: CloseYearPayload) =>
    apiClient.post<CloseYearResult>("/accounting/year-closing", dto),
};
