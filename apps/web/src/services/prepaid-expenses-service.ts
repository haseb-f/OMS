import { apiClient } from "./api-client";
import { compactPayload } from "@/lib/compact-payload";
import { createMasterDataService } from "./master-data-service";
import type {
  ScheduleJournalRef,
  ScheduleRow,
  SourceInvoiceRef,
} from "./accounting-schedules-service";

export interface PrepaidExpenseRow {
  id: string;
  prepaidNumber: string;
  name: string;
  amount: string | number;
  startDate: string;
  endDate: string;
  totalPeriods: number;
  recognizedAmount: string | number;
  status: "DRAFT" | "ACTIVE" | "COMPLETED" | "CANCELLED";
  expenseAccountId: string;
  expenseAccount?: { id: string; code: string; name: string } | null;
  receivingAccountId: string | null;
  receivingAccount?: { id: string; code?: string; name: string } | null;
  partner?: { id: string; name: string } | null;
  currency?: { id: string; code: string } | null;
  notes: string | null;
  deletedAt: string | null;
}

/** `GET /prepaid-expenses/:id` — the prepayment with its schedule, entries and running amounts. */
export interface PrepaidExpenseDetail extends PrepaidExpenseRow, SourceInvoiceRef {
  purchaseInvoiceId: string | null;
  purchaseInvoiceItemId: string | null;
  activatedAt: string | null;
  recognitions: ScheduleRow[];
  journalEntries: {
    deferral: ScheduleJournalRef | null;
    deferralSource: "PURCHASE_INVOICE" | "PREPAID_EXPENSE";
  };
  summary: {
    amount: number;
    recognizedAmount: number;
    remainingAmount: number;
    postedPeriods: number;
    pendingPeriods: number;
    cancelledPeriods: number;
    failedPeriods: number;
  };
}

export interface PrepaidRecognizeResult {
  asOf: string;
  postedCount: number;
  failedCount: number;
}

const base = createMasterDataService<PrepaidExpenseRow>("/prepaid-expenses");

export const prepaidExpensesService = {
  ...base,
  create: (dto: Record<string, unknown>) => base.create(compactPayload(dto)),
  update: (id: string, dto: Record<string, unknown>) => base.update(id, compactPayload(dto)),
  restore: (id: string) => base.archive(id),
  detail: (id: string) => apiClient.get<PrepaidExpenseDetail>(`/prepaid-expenses/${id}`),
  activate: (id: string) =>
    apiClient.post<PrepaidExpenseRow>(`/prepaid-expenses/${id}/activate`, {}),
  /** Posts every recognition due today (Cairo) — the prepaid half of the scheduled run. */
  recognize: () => apiClient.post<PrepaidRecognizeResult>("/prepaid-expenses/recognize", {}),
};
