import type { StatusTone } from "@/components/business/status-badge";
import type { JournalEntryStatusValue } from "@/services/journal-entries-service";
import type { MessageKey } from "@/i18n/translate";

export const JOURNAL_ENTRY_STATUS_LABEL_KEY: Record<JournalEntryStatusValue, MessageKey> = {
  DRAFT: "accounting.journalEntries.status.draft",
  POSTED: "accounting.journalEntries.status.posted",
  REVERSED: "accounting.journalEntries.status.reversed",
};

export const JOURNAL_ENTRY_STATUS_TONE: Record<JournalEntryStatusValue, StatusTone> = {
  DRAFT: "neutral",
  POSTED: "success",
  REVERSED: "warning",
};

export const JOURNAL_ENTRY_FILTERABLE_STATUSES: JournalEntryStatusValue[] = [
  "DRAFT",
  "POSTED",
  "REVERSED",
];
/** Draft-only — a Posted entry is permanent ledger history and must never be hidden via archive; Reverse is the correct undo. */
export const JOURNAL_ENTRY_ARCHIVABLE_STATUSES: JournalEntryStatusValue[] = ["DRAFT"];
