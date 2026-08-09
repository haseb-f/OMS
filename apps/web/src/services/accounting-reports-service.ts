import { apiClient } from "./api-client";
import type { JournalEntryStatusValue } from "./journal-entries-service";

/** TASK-047 Financial Reports — read-only client for the General Ledger, Trial Balance, Journal Report, and Account Statement endpoints. */

export interface ReportFilterParams {
  companyId?: string;
  branchId?: string;
  costCenterId?: string;
  projectId?: string;
  currencyId?: string;
  dateFrom?: string;
  dateTo?: string;
  postedOnly?: boolean;
  search?: string;
  page?: number;
  pageSize?: number;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
}

export interface AccountLedgerAccount {
  id: string;
  code: string;
  name: string;
  accountType: string;
}

export interface AccountLedgerMovement {
  journalEntryId: string;
  entryNumber: string;
  entryDate: string;
  description: string | null;
  sourceType: string | null;
  sourceId: string | null;
  referenceNumber: string | null;
  status: JournalEntryStatusValue;
  debit: number;
  credit: number;
  runningBalance: number;
}

export interface AccountLedger {
  account: AccountLedgerAccount;
  openingBalance: number;
  periodDebit: number;
  periodCredit: number;
  closingBalance: number;
  movements: AccountLedgerMovement[];
}

export interface GeneralLedgerParams extends ReportFilterParams {
  accountId?: string;
}

export interface GeneralLedgerResult {
  items: AccountLedger[];
  total: number;
  page: number;
  pageSize: number;
}

export interface TrialBalanceRow {
  accountId: string;
  accountCode: string;
  accountName: string;
  accountType: string;
  debitTotal: number;
  creditTotal: number;
  balance: number;
}

export interface TrialBalanceResult {
  items: TrialBalanceRow[];
  total: number;
  page: number;
  pageSize: number;
  totals: { debitTotal: number; creditTotal: number };
}

export interface JournalReportLine {
  id: string;
  accountId: string;
  account: { id: string; code: string; name: string };
  description: string | null;
  debit: string;
  credit: string;
  lineOrder: number;
}

export interface JournalReportEntry {
  id: string;
  entryNumber: string;
  entryDate: string;
  description: string | null;
  status: JournalEntryStatusValue;
  totalDebit: string;
  totalCredit: string;
  sourceType: string | null;
  referenceNumber: string | null;
  postedBy: string | null;
  lines: JournalReportLine[];
}

export interface JournalReportResult {
  items: JournalReportEntry[];
  total: number;
  page: number;
  pageSize: number;
}

export interface StatementRow {
  accountId: string;
  accountCode: string;
  accountName: string;
  balance: number;
}

export interface BalanceSheetResult {
  asOfDate: string;
  assets: StatementRow[];
  liabilities: StatementRow[];
  equity: StatementRow[];
  currentEarnings: number;
  totals: { totalAssets: number; totalLiabilities: number; totalEquity: number; balanced: boolean };
}

export interface IncomeStatementResult {
  revenue: StatementRow[];
  expense: StatementRow[];
  totals: { totalRevenue: number; totalExpense: number; netIncome: number };
}

export interface CashFlowMovement {
  sourceType: string;
  netChange: number;
}

export interface CashFlowResult {
  openingBalance: number;
  movements: CashFlowMovement[];
  totals: { netCashChange: number; closingBalance: number };
}

function buildQueryString(params: Record<string, unknown>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    search.set(key, String(value));
  }
  const qs = search.toString();
  return qs ? `?${qs}` : "";
}

export const accountingReportsService = {
  generalLedger: (params: GeneralLedgerParams = {}) =>
    apiClient.get<GeneralLedgerResult>(
      `/accounting/reports/general-ledger${buildQueryString(params as Record<string, unknown>)}`,
    ),
  trialBalance: (params: ReportFilterParams = {}) =>
    apiClient.get<TrialBalanceResult>(
      `/accounting/reports/trial-balance${buildQueryString(params as Record<string, unknown>)}`,
    ),
  journalReport: (params: ReportFilterParams = {}) =>
    apiClient.get<JournalReportResult>(
      `/accounting/reports/journal-report${buildQueryString(params as Record<string, unknown>)}`,
    ),
  accountStatement: (accountId: string, params: ReportFilterParams = {}) =>
    apiClient.get<AccountLedger>(
      `/accounting/reports/account-statement${buildQueryString({ ...params, accountId } as Record<string, unknown>)}`,
    ),
  balanceSheet: (params: ReportFilterParams = {}) =>
    apiClient.get<BalanceSheetResult>(
      `/accounting/reports/balance-sheet${buildQueryString(params as Record<string, unknown>)}`,
    ),
  incomeStatement: (params: ReportFilterParams = {}) =>
    apiClient.get<IncomeStatementResult>(
      `/accounting/reports/income-statement${buildQueryString(params as Record<string, unknown>)}`,
    ),
  cashFlow: (params: ReportFilterParams = {}) =>
    apiClient.get<CashFlowResult>(
      `/accounting/reports/cash-flow${buildQueryString(params as Record<string, unknown>)}`,
    ),
};
