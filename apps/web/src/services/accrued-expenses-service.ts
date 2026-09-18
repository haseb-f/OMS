import { apiClient } from "./api-client";
import { compactPayload } from "@/lib/compact-payload";
import { createMasterDataService } from "./master-data-service";

export interface AccruedExpenseRow {
  id: string;
  accrualNumber: string;
  name: string;
  amount: string | number;
  recognitionDate: string;
  status: "DRAFT" | "RECOGNIZED" | "SETTLED";
  expenseAccountId: string;
  expenseAccount?: { id: string; code: string; name: string } | null;
  receivingAccountId: string | null;
  receivingAccount?: { id: string; code: string; name: string } | null;
  notes: string | null;
  deletedAt: string | null;
}

const base = createMasterDataService<AccruedExpenseRow>("/accrued-expenses");

export const accruedExpensesService = {
  ...base,
  create: (dto: Record<string, unknown>) => base.create(compactPayload(dto)),
  update: (id: string, dto: Record<string, unknown>) => base.update(id, compactPayload(dto)),
  activity: async () => [],
  restore: (id: string) => base.archive(id),
  recognize: (id: string) =>
    apiClient.post<AccruedExpenseRow>(`/accrued-expenses/${id}/recognize`, {}),
  settle: (id: string, dto: { receivingAccountId: string }) =>
    apiClient.post<AccruedExpenseRow>(`/accrued-expenses/${id}/settle`, dto),
};
