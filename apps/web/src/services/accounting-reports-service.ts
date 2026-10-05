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
  /** Only on the ledger of a currency-bound (non-functional) account — see `AccountNativeSummary`. */
  native?: AccountNativeMovement | null;
}

/**
 * Native-currency amount of one ledger line of a foreign-currency account,
 * derived from the entry's frozen rate. `debit/credit/runningBalance` are null
 * when the line cannot prove a native amount (posted in another currency, or no
 * rate recorded) — never guessed.
 */
export interface AccountNativeMovement {
  lineId: string;
  status: "PROVEN" | "ENTRY_CURRENCY_DIFFERS" | "NO_RATE_RECORDED";
  debit: number | null;
  credit: number | null;
  runningBalance: number | null;
  rate: number | null;
  rateSource: string | null;
  rateAsOf: string | null;
}

/** Native-currency balances of a currency-bound account (sum of native amounts, not a re-translation). */
export interface AccountNativeSummary {
  currencyId: string;
  currencyCode: string;
  functionalCurrencyCode: string;
  openingBalance: number;
  periodDebit: number;
  periodCredit: number;
  closingBalance: number;
  unprovenLineCount: number;
  unprovenFunctionalAmount: number;
  complete: boolean;
}

export interface AccountLedger {
  account: AccountLedgerAccount;
  openingBalance: number;
  periodDebit: number;
  periodCredit: number;
  closingBalance: number;
  movements: AccountLedgerMovement[];
  /** Present when the account is bound to a non-functional currency. */
  native?: AccountNativeSummary | null;
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
  /** Opening, period and closing each net to zero (debit-positive); not meaningful while `filtered`. */
  checks?: {
    filtered: boolean;
    periodDifference: number;
    openingDifference: number;
    closingDifference: number;
    balanced: boolean;
  };
  warnings?: ReportWarning[];
  lines: HierarchicalReportLine[];
}

/** Statement integrity / classification warnings returned with a report. */
export interface ReportWarning {
  code:
    | "UNCLASSIFIED_ACCOUNTS"
    | "ROLE_CONFLICT"
    | "CAPITAL_RETURN_IN_PROFIT_OR_LOSS"
    | "DRAFTS_INCLUDED"
    | "CARRY_FORWARD_OPENING_ENTRY"
    | "UNBALANCED_ENTRIES";
  accounts?: Array<{ accountId: string; code: string; name: string; amount: number }>;
  entries?: Array<{ id: string; entryNumber: string; difference: number }>;
  /** CAPITAL_RETURN_IN_PROFIT_OR_LOSS: API list of the affected legacy postings. */
  correctionsEndpoint?: string;
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
  fiscalYearStart?: string;
  /** Africa/Cairo business dates of the as-of instant and the fiscal-year start. */
  asOfBusinessDate?: string;
  fiscalYearStartDate?: string;
  totals: {
    totalAssets: number;
    totalLiabilities: number;
    totalEquity: number;
    balanced: boolean;
    nonCurrentAssets?: number;
    currentAssets?: number;
    unclassifiedAssets?: number;
    nonCurrentLiabilities?: number;
    currentLiabilities?: number;
    unclassifiedLiabilities?: number;
    equityAccounts?: number;
    priorPeriodsUnclosedProfit?: number;
    currentYearProfit?: number;
    currentYearClosedToRetainedEarnings?: number;
    totalLiabilitiesAndEquity?: number;
    difference?: number;
    cashAndCashEquivalents?: number;
  };
  /** Only when unbalanced: the difference and the entries whose lines do not net to zero. */
  discrepancy?: {
    difference: number;
    unbalancedEntries: Array<{ id: string; entryNumber: string; difference: number }>;
  } | null;
  warnings?: ReportWarning[];
  lines: HierarchicalReportLine[];
}

export interface IncomeStatementResult {
  revenue: StatementRow[];
  expense: StatementRow[];
  totals: {
    totalRevenue: number;
    totalExpense: number;
    netIncome: number;
    grossRevenue?: number;
    revenueDeductions?: number;
    netRevenue?: number;
    costOfSales?: number;
    grossProfit?: number;
    sellingDistribution?: number;
    /** Net of each visible selling line (they add up to sellingDistribution). */
    shippingDelivery?: number;
    paymentGatewayFees?: number;
    fulfillment?: number;
    otherSelling?: number;
    /** Selling expense recovered from agents (positive) — a contra line, never expense. */
    recoveredFromAgents?: number;
    administrative?: number;
    operatingProfit?: number;
    otherIncome?: number;
    otherExpenses?: number;
    financeCosts?: number;
    fxDifferences?: number;
    unclassified?: number;
  };
  partitionDifference?: number;
  warnings?: ReportWarning[];
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
  /** Activities view: opening + operating + investing + financing + FX effect = closing = ledger. */
  reconciliation?: {
    openingCash: number;
    operating: number;
    investing: number;
    financing: number;
    fxEffect: number;
    netChange: number;
    /** Cash brought in by OPENING_BALANCE entries in the period (outside the activities). */
    openingBalanceEntries: number;
    closingCash: number;
    /** Independent: cash accounts' as-of balance at period end (same source as the Balance Sheet). */
    ledgerClosingCash: number;
    difference: number;
    balanced: boolean;
    internalTransfers: number;
  };
  warnings?: ReportWarning[];
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
    /** Posted ledger balance in the functional currency (historical rates). */
    bookBalanceFunctional?: number;
    /** Foreign accounts: whether every line proves its native amount. */
    native?: {
      complete: boolean;
      unprovenLineCount: number;
      unprovenFunctionalAmount: number;
    } | null;
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
  /** The configured base (functional) currency the consolidated figures are in (empty = not configured). */
  functionalCurrencyCode: string;
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
