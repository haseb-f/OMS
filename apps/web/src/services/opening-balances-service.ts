import { apiClient } from "./api-client";
import type { JournalEntryRow } from "./journal-entries-service";

export interface OpeningBalanceLineInputPayload {
  accountId: string;
  description?: string;
  debit?: number;
  credit?: number;
}

export interface CreateOpeningBalancePayload {
  fiscalYearId: string;
  openingDate: string;
  lines: OpeningBalanceLineInputPayload[];
}

/**
 * Opening Balance Wizard (TASK-055 Part 4) — produces one JournalEntry via
 * the existing Journal Engine (`sourceType='OPENING_BALANCE'`). Reading
 * "does this Fiscal Year already have one" reuses the existing Journal
 * Entries list filter (`journalEntriesService.list({sourceType, sourceId})`,
 * TASK-054) — no duplicate read endpoint here.
 */
export const openingBalancesService = {
  create: (dto: CreateOpeningBalancePayload) =>
    apiClient.post<JournalEntryRow>("/accounting/opening-balances", dto),
};
