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
  includeOpeningBalance?: boolean;
}

export interface AccountLedgerAccount {
  id: string;
  code: string;
  name: string;
  nameEn?: string | null;
  accountType: string;
}

/** One Journal Entry line as every ledger-style report returns it (GL, Account/Partner Statement). */
export interface AccountLedgerMovement {
  lineId: string;
  journalEntryId: string;
  entryNumber: string;
  entryDate: string;
  description: string | null;
  sourceType: string | null;
  sourceId: string | null;
  referenceNumber: string | null;
  status: JournalEntryStatusValue;
  journal: { id: string; code: string; name: string } | null;
  partner: { id: string; partnerNumber: string; name: string } | null;
  accountId: string;
  accountCode: string;
  accountName: string;
  accountNameEn: string | null;
  partnerControlType: "RECEIVABLE" | "PAYABLE" | null;
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
  /** Sent comma-separated. */
  accountIds?: string[];
  /** Also list accounts with no opening balance and no movement. */
  includeEmpty?: boolean;
}

export interface GeneralLedgerResult {
  items: AccountLedger[];
  /** Matched accounts (all pages). */
  total: number;
  page: number;
  pageSize: number;
  /** Across every matched account, not only this page — equals the Trial Balance. */
  totals: {
    openingBalance: number;
    periodDebit: number;
    periodCredit: number;
    closingBalance: number;
  };
  balanced: boolean;
}

export interface HierarchicalReportLine {
  id: string;
  parentId: string | null;
  kind:
    | "section"
    | "group"
    | "posting"
    | "subtotal"
    | "section_total"
    | "opening"
    | "closing"
    | "grand_total"
    | "result"
    | "spacer";
  level: number;
  code?: string;
  label: string;
  labelEn?: string | null;
  accountId?: string;
  accountType?: string;
  allowsPosting?: boolean;
  expandable: boolean;
  values: Record<string, number>;
  children: HierarchicalReportLine[];
}

export interface TrialBalanceRow {
  accountId: string;
  accountCode: string;
  accountName: string;
  accountType: string;
  openingBalance?: number;
  debitTotal: number;
  creditTotal: number;
  closingBalance?: number;
  balance: number;
}

export interface TrialBalanceResult {
  items: TrialBalanceRow[];
  total: number;
  page: number;
  pageSize: number;
  totals: {
    debitTotal: number;
    creditTotal: number;
    openingBalance?: number;
    closingBalance?: number;
  };
  includeOpeningBalance?: boolean;
  balanced?: boolean;
  lines: HierarchicalReportLine[];
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
  lines: HierarchicalReportLine[];
}

export interface IncomeStatementResult {
  revenue: StatementRow[];
  expense: StatementRow[];
  totals: { totalRevenue: number; totalExpense: number; netIncome: number };
  lines: HierarchicalReportLine[];
}

export interface CashFlowMovement {
  sourceType: string;
  netChange: number;
}

/** `activities` = operating/investing/financing; `movement` = cash-account movement detail. */
export type CashFlowView = "activities" | "movement";

export interface CashFlowResult {
  view?: CashFlowView;
  openingBalance: number;
  movements?: CashFlowMovement[];
  totals: {
    netCashChange: number;
    closingBalance: number;
    openingBalance?: number;
    inflows?: number;
    outflows?: number;
  };
  lines: HierarchicalReportLine[];
  sections?: Array<{ section: string; netChange: number }>;
}

export type AgingBucket = "current" | "days31to60" | "days61to90" | "over90";

export interface AgingPartnerRow {
  partnerId: string;
  partnerNumber: string;
  partnerName: string;
  current: number;
  days31to60: number;
  days61to90: number;
  over90: number;
  total: number;
}

export interface AgingInvoiceRow {
  invoiceId: string;
  invoiceNumber: string;
  partnerId: string;
  partnerName: string;
  invoiceDate: string;
  daysOutstanding: number;
  bucket: AgingBucket;
  grandTotal: number;
  allocated: number;
  remaining: number;
}

export interface AgingResult {
  side: "AR" | "AP";
  asOfDate: string;
  partners: AgingPartnerRow[];
  invoices: AgingInvoiceRow[];
  totals: AgingPartnerRow & { partnerId?: string; partnerNumber?: string; partnerName?: string };
}

export type PartnerStatementMovement = AccountLedgerMovement;

export type PartnerControlType = "RECEIVABLE" | "PAYABLE";

export interface PartnerStatementParams extends ReportFilterParams {
  /** Receivable (customer) or Payable (supplier) control-account lines only. */
  controlType?: PartnerControlType;
}

/** Always the full statement for the date range — never paged. */
export interface PartnerStatementResult {
  partner: { id: string; partnerNumber: string; name: string };
  controlType: PartnerControlType | null;
  openingBalance: number;
  periodDebit: number;
  periodCredit: number;
  closingBalance: number;
  movements: PartnerStatementMovement[];
  total: number;
}

function buildQueryString(params: Record<string, unknown>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    if (Array.isArray(value)) {
      if (value.length > 0) search.set(key, value.join(","));
      continue;
    }
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
  cashFlow: (params: ReportFilterParams & { view?: CashFlowView } = {}) =>
    apiClient.get<CashFlowResult>(
      `/accounting/reports/cash-flow${buildQueryString(params as Record<string, unknown>)}`,
    ),
  arAging: (params: ReportFilterParams & { partnerId?: string } = {}) =>
    apiClient.get<AgingResult>(
      `/accounting/reports/ar-aging${buildQueryString(params as Record<string, unknown>)}`,
    ),
  apAging: (params: ReportFilterParams & { partnerId?: string } = {}) =>
    apiClient.get<AgingResult>(
      `/accounting/reports/ap-aging${buildQueryString(params as Record<string, unknown>)}`,
    ),
  partnerStatement: (partnerId: string, params: PartnerStatementParams = {}) =>
    apiClient.get<PartnerStatementResult>(
      `/accounting/reports/partner-statement${buildQueryString({ ...params, partnerId } as Record<string, unknown>)}`,
    ),
  cashAvailability: (params: { asOf?: string; currencyId?: string; accountId?: string } = {}) =>
    apiClient.get<CashAvailabilityResult>(
      `/accounting/reports/cash-availability${buildQueryString(params as Record<string, unknown>)}`,
    ),
  periodProfit: (
    params: {
      dateFrom?: string;
      dateTo?: string;
      targetCurrencyIds?: string;
    } = {},
  ) =>
    apiClient.get<PeriodProfitResult>(
      `/accounting/reports/period-profit${buildQueryString(params as Record<string, unknown>)}`,
    ),
};

export interface CashAvailabilityResult {
  asOfDate: string;
  formula: string;
  limitations: string[];
  accounts: Array<{
    receivingAccountId: string;
    accountCode: string;
    accountName: string;
    currencyCode: string;
    bookBalance: number;
    recordedHolds: number;
    committedOutgoing: number;
    availableToSpend: number;
    availabilityKind: "ESTIMATE";
    bankConfirmedAvailable: number | null;
    egpEquivalent: {
      bookBalance: number | null;
      availableToSpend: number | null;
      rate: number | null;
      rateEffectiveDate: string | null;
      rateSource: string | null;
      convention: string | null;
    };
  }>;
  totalsByCurrency: Array<{ currencyCode: string; book: number; available: number }>;
  egpConsolidated: { bookBalance: number; availableToSpend: number; note: string };
}

export interface PeriodProfitResult {
  netProfitEgp: number;
  functionalCurrencyCode: string;
  asOfDate: string;
  equivalents: Array<{
    currencyCode: string;
    amount: number | null;
    rate: number | null;
    rateEffectiveDate: string | null;
    source: string | null;
    convention: string | null;
    presentationOnly: boolean;
  }>;
  note: string;
}
