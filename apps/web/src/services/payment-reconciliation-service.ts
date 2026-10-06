import { apiClient } from "./api-client";
import { buildQueryString } from "@/lib/query-string";
import type { BulkItemsResult } from "./payments-review-service";

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
/** R13 D2 — a refund / chargeback row is imported for review (positive amount) and never matched. */
export type StatementLineKind = "PAYMENT" | "REFUND" | "CHARGEBACK";
export type StatementSourceType = "FILE" | "GOOGLE_SHEET" | "MANUAL";
export type ClaimStatus = "PENDING" | "MATCHED" | "VERIFIED" | "REJECTED" | "DISPUTED";

export type CurrencyTotals = Record<string, { count: number; amount: number }>;

export interface MethodSummary {
  /** Payment lines per status (refund / chargeback lines are counted in `refundLines`). */
  lines: Record<StatementLineStatus, number>;
  refundLines?: number;
  unmatchedByCurrency: CurrencyTotals;
  /** Statement totals (ignored lines excluded): payments, refunds / chargebacks and net. */
  statementPaymentsByCurrency?: CurrencyTotals;
  statementRefundsByCurrency?: CurrencyTotals;
  statementNetByCurrency?: CurrencyTotals;
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
  /** What "correct match" would do: cancel a receipt posted by this match, or only release the allocation. */
  reversalEffect: MatchReversalEffect | null;
}

export type MatchReversalEffect = "REVERSE_POSTING" | "UNMATCH";

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
  kind?: StatementLineKind;
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

/** Where a preview's mapping came from: the caller's own, the method's saved file mapping, or a header guess. */
export type StatementMappingSource = "PROVIDED" | "SAVED" | "SUGGESTED";

export interface StatementPreview {
  headers: string[];
  sheetName: string | null;
  mapping: StatementMapping;
  mappingSource?: StatementMappingSource;
  mappingErrors: string[];
  summary: Omit<StatementRunSummary, "importId" | "deletedAtSourceRows"> | null;
  rows: {
    rowNumber: number;
    outcome: RowOutcome;
    errors: string[];
    row: {
      kind?: StatementLineKind;
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

export type SuggestionBlockedCode =
  "NOT_A_PAYMENT" | "PROVIDER_STATUS_FAILED" | "LINE_NOT_UNMATCHED" | "LINE_FULLY_ALLOCATED";

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
    providerReference?: string | null;
    amount: number;
    matchedAmount: number;
    remaining: number;
    currency: { id: string; code: string };
    status: StatementLineStatus;
    kind?: StatementLineKind;
    providerStatusClass: "SUCCESS" | "FAILED" | "UNKNOWN";
  };
  candidates: Suggestion[];
  ambiguous: boolean;
  /** Why the line takes no suggestions — translated via `paymentVocabulary.blocked.*`. */
  blockedCode?: SuggestionBlockedCode | null;
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

/** A statement line as the match panel shows it (business fields + collapsed provenance). */
export interface StatementLineView {
  id: string;
  providerReference: string | null;
  orderReference: string | null;
  customerName: string | null;
  customerPhone: string | null;
  amount: number;
  matchedAmount: number;
  remaining: number;
  currency: { id: string; code: string };
  transactionDate: string;
  providerStatus: string | null;
  feeAmount: number | null;
  netAmount: number | null;
  status: StatementLineStatus;
  technical: {
    importId: string | null;
    sourceType: StatementSourceType;
    fileName: string | null;
    sheetName: string | null;
    rowNumber: number | null;
    importedAt: string;
    dedupeKey: string;
    rowHash: string | null;
    rawRow: Record<string, string> | null;
  };
}

export interface ClaimLineCandidate {
  paymentId: string;
  score: number;
  strength: SuggestionStrength;
  reasons: MatchReason[];
  amountMatches: boolean;
  suggestible: boolean;
  dayDistance: number;
  line: StatementLineView;
}

export interface ClaimActiveMatch {
  id: string;
  amount: number;
  reasons: MatchReason[] | null;
  confirmedAt: string;
  reversalEffect: MatchReversalEffect;
  settled: boolean;
  line: StatementLineView;
}

/** `GET …/claims/:paymentId/lines` — the match panel's statement side. */
export interface ClaimLines {
  claim: ClaimView;
  receipt: { id: string; transactionNumber: string; status: string } | null;
  journalEntry: { id: string; entryNumber: string } | null;
  activeMatches: ClaimActiveMatch[];
  candidates: ClaimLineCandidate[];
  ambiguous: boolean;
}

export interface BulkAcceptPlan {
  /** Statement line id. */
  id: string;
  providerReference: string | null;
  paymentId: string;
  paymentNumber: string;
  orderNumber: string | null;
  amount: number;
  currencyCode: string;
  posted?: boolean;
  receiptId?: string | null;
  replayed?: boolean;
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
      kind?: StatementLineKind;
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
  claimLines: (methodId: string, paymentId: string) =>
    apiClient.get<ClaimLines>(`${base(methodId)}/claims/${paymentId}/lines`),
  /** Dry run plans strong, unambiguous suggestions; commit re-plans and confirms each line on its own. */
  bulkAccept: (
    methodId: string,
    body: {
      items: { statementLineId: string; paymentId?: string }[];
      dryRun?: boolean;
      idempotencyKey?: string;
    },
  ) =>
    apiClient.post<BulkItemsResult<BulkAcceptPlan>>(`${base(methodId)}/matches/bulk-accept`, body),
};
