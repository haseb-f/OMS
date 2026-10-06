import { apiClient } from "./api-client";

/** One depreciation period / prepaid recognition row (R13 spec C2). */
export type ScheduleRowStatus = "PENDING" | "POSTED" | "CANCELLED";

export interface ScheduleJournalRef {
  id: string;
  entryNumber: string;
  entryDate: string;
}

export interface ScheduleRow {
  id: string;
  periodStart: string;
  periodEnd: string;
  amount: string | number;
  status: ScheduleRowStatus;
  postedAt: string | null;
  lastError: string | null;
  lastAttemptAt: string | null;
  /** The entry the Posting Engine created for this row (sourceId = row id). */
  journalEntry: ScheduleJournalRef | null;
}

/** A computed (not yet stored) schedule row with running totals. */
export interface SchedulePreviewRow {
  index: number;
  periodStart: string;
  periodEnd: string;
  amount: number;
  cumulative: number;
  /** Book value (asset) / unrecognized balance (prepaid) after this period. */
  remaining: number;
}

export interface SchedulePreview {
  startDate: string | null;
  endDate: string | null;
  periods: SchedulePreviewRow[];
}

/** The purchase invoice line a fixed asset / prepaid expense came from. */
export interface SourceInvoiceRef {
  purchaseInvoice: {
    id: string;
    invoiceNumber: string;
    status: string;
    confirmedAt: string | null;
    partner?: { id: string; name: string } | null;
  } | null;
  purchaseInvoiceItem: {
    id: string;
    description: string | null;
    quantity: number;
    unitPrice: string;
    lineTotal: string;
    taxAmount: string;
    product?: { id: string; name: string; displayName: string | null } | null;
  } | null;
}

export interface ScheduleRunResult {
  asOf: string;
  depreciation: { posted: number; failed: number };
  prepaid: { posted: number; failed: number };
}

export const accountingSchedulesService = {
  /** "Process due entries" — the same run the daily cron performs (periods ending on/before today, Cairo). */
  runDue: () => apiClient.post<ScheduleRunResult>("/accounting-schedules/run", {}),
};
