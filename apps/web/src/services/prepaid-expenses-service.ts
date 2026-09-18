import { apiClient } from "./api-client";
import { compactPayload } from "@/lib/compact-payload";
import { createMasterDataService } from "./master-data-service";

export interface PrepaidExpenseRow {
  id: string;
  prepaidNumber: string;
  name: string;
  amount: string | number;
  startDate: string;
  endDate: string;
  totalPeriods: number;
  recognizedAmount: string | number;
  status: "DRAFT" | "ACTIVE" | "COMPLETED";
  expenseAccountId: string;
  expenseAccount?: { id: string; code: string; name: string } | null;
  receivingAccountId: string;
  receivingAccount?: { id: string; code: string; name: string } | null;
  notes: string | null;
  deletedAt: string | null;
}

const base = createMasterDataService<PrepaidExpenseRow>("/prepaid-expenses");

export const prepaidExpensesService = {
  ...base,
  create: (dto: Record<string, unknown>) => base.create(compactPayload(dto)),
  update: (id: string, dto: Record<string, unknown>) => base.update(id, compactPayload(dto)),
  activity: async () => [],
  restore: (id: string) => base.archive(id),
  activate: (id: string) =>
    apiClient.post<PrepaidExpenseRow>(`/prepaid-expenses/${id}/activate`, {}),
  recognize: (dto: { asOf?: string } = {}) =>
    apiClient.post<{ asOf: string; postedCount: number; recognitionIds: string[] }>(
      "/prepaid-expenses/recognize",
      dto,
    ),
};
