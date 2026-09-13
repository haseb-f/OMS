import { apiClient } from "./api-client";
import { buildQueryString } from "@/lib/query-string";

export type InvestorLedgerEntryType =
  | "CAPITAL_FUNDED"
  | "PROFIT_ENTITLEMENT"
  | "PROFIT_PAYMENT"
  | "CAPITAL_RETURN"
  | "ADJUSTMENT"
  | "REVERSAL";

export interface InvestorLedgerEntryRow {
  id: string;
  investorId: string;
  opportunityId: string | null;
  entryDate: string;
  type: InvestorLedgerEntryType;
  description: string;
  referenceType: string;
  referenceId: string;
  debitAmount: number;
  creditAmount: number;
  createdAt: string;
}

export interface InvestorFinancialSummary {
  totalConfirmedCapital: number;
  capitalReturned: number;
  remainingCapitalPosition: number;
  totalApprovedProfit: number;
  totalProfitPaid: number;
  outstandingProfit: number;
  activeOpportunities: number;
  completedOpportunities: number;
}

export interface CreateLedgerAdjustmentPayload {
  investorId: string;
  opportunityId?: string;
  amount: number;
  direction: "DEBIT" | "CREDIT";
  reason: string;
}

const basePath = "/investor-ledger";

export const investorLedgerService = {
  statement: (
    investorId: string,
    params: {
      opportunityId?: string;
      type?: InvestorLedgerEntryType[];
      dateFrom?: string;
      dateTo?: string;
      page?: number;
      pageSize?: number;
    } = {},
  ) =>
    apiClient.get<{
      items: InvestorLedgerEntryRow[];
      total: number;
      page: number;
      pageSize: number;
    }>(`${basePath}/statement/${investorId}${buildQueryString(params)}`),
  summary: (investorId: string) =>
    apiClient.get<InvestorFinancialSummary>(`${basePath}/summary/${investorId}`),
  adjust: (dto: CreateLedgerAdjustmentPayload) =>
    apiClient.post<InvestorLedgerEntryRow>(`${basePath}/adjust`, dto),
};
