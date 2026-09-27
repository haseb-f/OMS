import { apiClient } from "./api-client";
import { buildQueryString } from "@/lib/query-string";

/** payment-declaration-reconciliation — provider statements + matching per payment method. */

export const STATEMENT_FIELDS = [
  "providerReference",
  "customerName",
  "customerPhone",
  "amount",
  "currency",
  "transactionDate",
  "providerStatus",
  "orderReference",
  "fee",
  "net",
] as const;
export type StatementField = (typeof STATEMENT_FIELDS)[number];
export const REQUIRED_STATEMENT_FIELDS: StatementField[] = ["amount", "transactionDate"];

export type StatementDateFormat = "DMY" | "MDY" | "YMD";

export interface StatementMapping {
  columns: Partial<Record<StatementField, string>>;
  defaultCurrencyCode?: string | null;
  phoneRegion?: string | null;
  dateFormat?: StatementDateFormat | null;
}

export type StatementLineStatus = "UNMATCHED" | "MATCHED" | "EXCEPTION" | "IGNORED";
export type StatementSourceType = "FILE" | "GOOGLE_SHEET" | "MANUAL";
export type ClaimStatus = "PENDING" | "MATCHED" | "VERIFIED" | "REJECTED" | "DISPUTED";

export type CurrencyTotals = Record<string, { count: number; amount: number }>;

export interface MethodSummary {
  lines: Record<StatementLineStatus, number>;
  unmatchedByCurrency: CurrencyTotals;
  claimsAwaitingReconciliation: CurrencyTotals;
  disputedClaims: CurrencyTotals;
  awaitingSettlement: CurrencyTotals;
}

export interface ReconciliationMethod {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
  requiresReconciliation?: boolean;
  account: { id: string; code: string; name: string } | null;
  summary?: MethodSummary;
}

export interface MatchReason {
  signal: string;
  detail: string;
}

export interface StatementLineMatch {
  id: string;
  amount: number;
  status: "ACTIVE" | "REVERSED";
  reasons: MatchReason[] | null;
  confirmedAt: string;
  reversedAt: string | null;
  reversalReason: string | null;
  payment: {
    id: string;
    paymentNumber: string;
    status: ClaimStatus;
    amount: number;
    settlementStatus: string;
  };
  storeOrder: { id: string; internalOrderId: string; externalOrderId: string | null } | null;
  customer: { id: string; name: string } | null;
  receipt: { id: string; transactionNumber: string; status: string } | null;
  journalEntry: { id: string; entryNumber: string } | null;
}

export interface StatementLine {
  id: string;
  providerReference: string | null;
  customerName: string | null;
  customerPhone: string | null;
  customerPhoneE164: string | null;
  orderReference: string | null;
  amount: number;
  matchedAmount: number;
  remaining: number;
  currency: { id: string; code: string };
  transactionDate: string;
  providerStatus: string | null;
  feeAmount: number | null;
  netAmount: number | null;
  status: StatementLineStatus;
  exceptionReason: string | null;
  sourceType: StatementSourceType;
  provenance: {
    importId: string | null;
    sourceType: StatementSourceType;
    fileName: string | null;
    sheetName: string | null;
    rowNumber: number | null;
    importedAt: string;
    rawRow: Record<string, string> | null;
  };
  matches: StatementLineMatch[];
  createdAt: string;
  updatedAt: string;
}

export interface StatementLineList {
  items: StatementLine[];
  total: number;
  page: number;
  pageSize: number;
}

export type RowOutcome =
  "CREATE" | "DUPLICATE" | "UPDATE" | "REAPPEARED" | "EXCEPTION_CHANGED_AFTER_MATCH" | "ERROR";

export interface StatementRunSummary {
  importId: string | null;
  totalRows: number;
  createdRows: number;
  duplicateRows: number;
  updatedRows: number;
  reopenedRows: number;
  exceptionRows: number;
  deletedAtSourceRows?: number;
  errorRows: number;
  errors: { rowNumber: number; messages: string[] }[];
}

export interface StatementPreview {
  headers: string[];
  sheetName: string | null;
  mapping: StatementMapping;
  mappingErrors: string[];
  summary: Omit<StatementRunSummary, "importId" | "deletedAtSourceRows"> | null;
  rows: {
    rowNumber: number;
    outcome: RowOutcome;
    errors: string[];
    row: {
      providerReference: string | null;
      customerName: string | null;
      amount: number;
      currencyCode: string;
      transactionDate: string;
      providerStatus: string | null;
      feeAmount: number | null;
      netAmount: number | null;
    } | null;
    raw: Record<string, string>;
  }[];
}

export interface SheetConnection {
  id: string;
  /** Canonical https://docs.google.com/spreadsheets/d/<id>/edit[#gid=] built by the API from the validated id — never the typed text. */
  url: string | null;
  spreadsheetId: string;
  gid: string | null;
  sheetName: string | null;
  mapping: StatementMapping;
  isSyncing: boolean;
  lastSyncAt: string | null;
  lastSyncStatus: "SUCCESS" | "FAILED" | null;
  lastSyncError: string | null;
  lastSyncResult: StatementRunSummary | null;
  connectedAt: string;
}

export interface SheetSource {
  serviceAccountEmail: string | null;
  configured: boolean;
  connection: SheetConnection | null;
}

export interface StatementImportRow {
  id: string;
  sourceType: StatementSourceType;
  fileName: string | null;
  sheetName: string | null;
  totalRows: number;
  createdRows: number;
  duplicateRows: number;
  exceptionRows: number;
  errorRows: number;
  createdAt: string;
}

export interface ClaimView {
  id: string;
  paymentNumber: string;
  status: ClaimStatus;
  amount: number;
  remaining: number;
  currency: { id: string; code: string };
  paymentDate: string;
  referenceNumber: string | null;
  senderName: string;
  origin: string;
  declarationKind: "FULL" | "PARTIAL" | null;
  storeOrder: { id: string; internalOrderId: string; externalOrderId: string | null } | null;
  customer: { id: string; name: string; phone: string | null } | null;
  disputeReason?: string | null;
}

export type SuggestionStrength = "STRONG" | "MEDIUM" | "WEAK";

export interface Suggestion {
  paymentId: string;
  score: number;
  strength: SuggestionStrength;
  reasons: MatchReason[];
  amountMatches: boolean;
  suggestible: boolean;
  dayDistance: number;
  claim: ClaimView;
}

export interface SuggestionResult {
  line: {
    id: string;
    amount: number;
    matchedAmount: number;
    remaining: number;
    currency: { id: string; code: string };
    status: StatementLineStatus;
    providerStatusClass: "SUCCESS" | "FAILED" | "UNKNOWN";
  };
  candidates: Suggestion[];
  ambiguous: boolean;
  blockedReason: string | null;
}

export interface ConfirmMatchResult {
  statementLineId: string;
  lineStatus: StatementLineStatus;
  lineMatchedAmount: number;
  matches: { id: string; paymentId: string; amount: number }[];
  postings: {
    paymentId: string;
    posted: boolean;
    receiptId: string | null;
    alreadyPosted: boolean;
  }[];
  replayed: boolean;
}

export interface ReverseMatchResult {
  matchId: string;
  paymentId: string;
  paymentStatus: ClaimStatus;
  statementLineId: string;
  cancelledReceipt: { id: string; transactionNumber: string } | null;
}

export interface ManualLineInput {
  providerReference?: string;
  customerName?: string;
  customerPhone?: string;
  orderReference?: string;
  amount: number;
  currencyId: string;
  transactionDate: string;
  providerStatus?: string;
  feeAmount?: number;
  netAmount?: number;
}

const base = (methodId: string) => `/payment-reconciliation/methods/${methodId}`;

function statementForm(file: File, mapping: StatementMapping | null) {
  const form = new FormData();
  form.append("file", file);
  if (mapping) form.append("mapping", JSON.stringify(mapping));
  return form;
}

export const paymentReconciliationService = {
  listMethods: () => apiClient.get<ReconciliationMethod[]>("/payment-reconciliation/methods"),
  getMethod: (methodId: string) => apiClient.get<ReconciliationMethod>(base(methodId)),
  listLines: (
    methodId: string,
    params: {
      status?: StatementLineStatus;
      search?: string;
      importId?: string;
      page?: number;
      pageSize?: number;
    },
  ) => apiClient.get<StatementLineList>(`${base(methodId)}/lines${buildQueryString(params)}`),
  listImports: (methodId: string) =>
    apiClient.get<StatementImportRow[]>(`${base(methodId)}/imports`),
  awaitingClaims: (methodId: string) => apiClient.get<ClaimView[]>(`${base(methodId)}/claims`),
  searchClaims: (methodId: string, params: { search?: string; currencyId?: string }) =>
    apiClient.get<ClaimView[]>(`${base(methodId)}/claims/search${buildQueryString(params)}`),

  previewFile: (methodId: string, file: File, mapping: StatementMapping | null) =>
    apiClient.postForm<StatementPreview>(
      `${base(methodId)}/statements/preview`,
      statementForm(file, mapping),
    ),
  commitFile: (methodId: string, file: File, mapping: StatementMapping) =>
    apiClient.postForm<StatementRunSummary>(
      `${base(methodId)}/statements/commit`,
      statementForm(file, mapping),
    ),
  createManualLine: (methodId: string, input: ManualLineInput) =>
    apiClient.post<StatementRunSummary>(`${base(methodId)}/lines`, input),

  getSheetSource: (methodId: string) =>
    apiClient.get<SheetSource>(`${base(methodId)}/sheet-source`),
  previewSheet: (methodId: string, body: { url: string; mapping?: StatementMapping }) =>
    apiClient.post<StatementPreview>(`${base(methodId)}/sheet-source/preview`, body),
  connectSheet: (methodId: string, body: { url: string; mapping: StatementMapping }) =>
    apiClient.put<SheetConnection>(`${base(methodId)}/sheet-source`, body),
  syncSheet: (methodId: string) =>
    apiClient.post<StatementRunSummary>(`${base(methodId)}/sheet-source/sync`),

  suggestions: (methodId: string, lineId: string) =>
    apiClient.get<SuggestionResult>(`${base(methodId)}/lines/${lineId}/suggestions`),
  confirmMatch: (
    methodId: string,
    body: {
      statementLineId: string;
      allocations: { paymentId: string; amount: number }[];
      idempotencyKey: string;
    },
  ) => apiClient.post<ConfirmMatchResult>(`${base(methodId)}/matches`, body),
  dismissSuggestion: (methodId: string, lineId: string, paymentId: string, reason?: string) =>
    apiClient.post(`${base(methodId)}/lines/${lineId}/dismiss`, { paymentId, reason }),
  disputeClaim: (methodId: string, paymentId: string, reason: string) =>
    apiClient.post(`${base(methodId)}/claims/${paymentId}/dispute`, { reason }),
  reverseMatch: (methodId: string, matchId: string, reason: string) =>
    apiClient.post<ReverseMatchResult>(`${base(methodId)}/matches/${matchId}/reverse`, { reason }),
  ignoreLine: (methodId: string, lineId: string, reason: string) =>
    apiClient.post(`${base(methodId)}/lines/${lineId}/ignore`, { reason }),
  reopenLine: (methodId: string, lineId: string) =>
    apiClient.post(`${base(methodId)}/lines/${lineId}/reopen`),
};
