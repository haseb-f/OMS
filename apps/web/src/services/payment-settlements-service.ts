import { apiClient } from "./api-client";
import { buildQueryString } from "@/lib/query-string";

export type SettlementClaimStatus =
  "NOT_APPLICABLE" | "AWAITING_SETTLEMENT" | "PARTIALLY_SETTLED" | "SETTLED";
export type SettlementDocStatus = "POSTED" | "REVERSED";

export interface CurrencyRef {
  id: string;
  code: string;
}
export interface AccountRef {
  id: string;
  code: string;
  name: string;
}
export interface JournalRef {
  id: string;
  entryNumber: string;
  status: string;
}

export interface EligibleClaim {
  id: string;
  paymentNumber: string;
  paymentDate: string;
  status: string;
  settlementStatus: SettlementClaimStatus;
  referenceNumber: string | null;
  senderName: string;
  currency: CurrencyRef;
  amount: string;
  settledAmount: string;
  remainingAmount: string;
  storeOrder: { id: string; internalOrderId: string } | null;
  customer: { id: string; name: string } | null;
  receipt: {
    id: string;
    transactionNumber: string;
    exchangeRate: string | null;
    rateAsOf: string | null;
    journalEntryId: string | null;
    journalEntryNumber: string | null;
  } | null;
}

export interface CurrencyTotals {
  currency: CurrencyRef;
  count: number;
  amount: string;
  settledAmount: string;
  remainingAmount: string;
}

export interface EligibleClaimsResult {
  method: { id: string; name: string; clearingAccount: AccountRef | null };
  items: EligibleClaim[];
  totalsByCurrency: CurrencyTotals[];
}

export interface SettlementInput {
  paymentMethodId: string;
  claims: { paymentId: string; amount?: number }[];
  receivedAmount: number;
  receivedCurrencyId: string;
  receivingAccountId: string;
  /** YYYY-MM-DD */
  settlementDate: string;
  providerReference?: string;
  /** Cross-currency only — commission in the claim currency. */
  feeAmount?: number;
  notes?: string;
}

export interface RateBasis {
  currencyId: string;
  currencyCode: string;
  rate: string;
  asOf: string;
  effectiveDate: string;
  source: string;
  rateId: string | null;
  overrideId: string | null;
}

export type JournalLineRole = "BANK" | "COMMISSION" | "CLEARING" | "FX_DIFFERENCE";
export type FeeBasis = "GROSS_MINUS_RECEIVED" | "ENTERED" | "STATEMENT_FEES";

export interface SettlementPreview {
  paymentMethod: { id: string; name: string };
  settlementDate: string;
  claimCurrency: CurrencyRef;
  receivedCurrency: CurrencyRef;
  functionalCurrency: CurrencyRef;
  sameCurrency: boolean;
  grossAmount: string;
  receivedAmount: string;
  feeAmount: string;
  feeBasis: FeeBasis;
  suggestedFee: string | null;
  /** Functional currency; > 0 loss (debit), < 0 gain (credit). */
  fxDifference: string;
  functional: { bank: string; commission: string; clearing: string; fxDifference: string };
  rates: { claim: RateBasis; received: RateBasis };
  claims: {
    paymentId: string;
    paymentNumber: string;
    storeOrder: { id: string; internalOrderId: string } | null;
    customer: { id: string; name: string } | null;
    receipt: { id: string; transactionNumber: string };
    amount: string;
    remainingBefore: string;
    settleAmount: string;
    fullySettles: boolean;
    carryingAmountFunctional: string;
  }[];
  journalLines: {
    accountId: string;
    role: JournalLineRole;
    debit: number;
    credit: number;
    description: string;
    account: AccountRef | null;
  }[];
  totalDebit: string;
  totalCredit: string;
}

export interface SettlementSummary {
  id: string;
  settlementNumber: string;
  paymentMethodId: string;
  paymentMethod?: { id: string; name: string };
  settlementDate: string;
  providerReference: string | null;
  receivingAccount: { id: string; name: string; code: string };
  currency: CurrencyRef;
  receivedCurrency: CurrencyRef;
  grossAmount: string;
  receivedAmount: string;
  feeAmount: string;
  fxDifference: string;
  status: SettlementDocStatus;
  createdAt: string;
  reversedAt: string | null;
  lineCount?: number;
  journalEntry: JournalRef | null;
  reversalJournalEntry: JournalRef | null;
}

export interface SettlementDetail extends Omit<SettlementSummary, "journalEntry"> {
  paymentMethod: { id: string; name: string; account: AccountRef | null };
  conversionBasis: {
    functionalCurrency: CurrencyRef;
    claimRate: RateBasis;
    receivedRate: RateBasis;
    feeBasis: FeeBasis;
    functional: { bank: string; commission: string; clearing: string; fxDifference: string };
  } | null;
  notes: string | null;
  lines: {
    id: string;
    amount: string;
    carryingAmountFunctional: string;
    payment: {
      id: string;
      paymentNumber: string;
      paymentDate: string;
      amount: string;
      settledAmount: string;
      settlementStatus: SettlementClaimStatus;
      senderName: string;
    };
    storeOrder: { id: string; internalOrderId: string } | null;
    customer: { id: string; name: string } | null;
    receipt: {
      id: string;
      transactionNumber: string;
      journalEntryId: string | null;
      journalEntryNumber: string | null;
    } | null;
  }[];
  journalEntry: {
    id: string;
    entryNumber: string;
    entryDate: string;
    status: string;
    exchangeRate: string | null;
    totalDebit: string;
    totalCredit: string;
    lines: { account: AccountRef; description: string | null; debit: string; credit: string }[];
  } | null;
  replayed?: boolean;
}

export interface SettlementListResult {
  items: SettlementSummary[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ProviderBalance {
  paymentMethod: { id: string; name: string };
  clearingAccount: AccountRef | null;
  functionalCurrency: CurrencyRef | null;
  glBalance: string | null;
  unsettledCarrying: string | null;
  difference: string | null;
  unsettledByCurrency: {
    currency: CurrencyRef;
    count: number;
    remainingAmount: string;
    carryingFunctional: string;
  }[];
  configured: boolean;
}

export const paymentSettlementsService = {
  eligible: (paymentMethodId: string) =>
    apiClient.get<EligibleClaimsResult>(
      `/payment-settlements/eligible${buildQueryString({ paymentMethodId })}`,
    ),
  preview: (input: SettlementInput) =>
    apiClient.post<SettlementPreview>("/payment-settlements/preview", input),
  create: (input: SettlementInput & { idempotencyKey: string }) =>
    apiClient.post<SettlementDetail>("/payment-settlements", input),
  list: (params: {
    paymentMethodId?: string;
    status?: SettlementDocStatus;
    dateFrom?: string;
    dateTo?: string;
    search?: string;
    page?: number;
    pageSize?: number;
  }) => apiClient.get<SettlementListResult>(`/payment-settlements${buildQueryString(params)}`),
  get: (id: string) => apiClient.get<SettlementDetail>(`/payment-settlements/${id}`),
  reverse: (id: string, reason: string) =>
    apiClient.post<SettlementDetail>(`/payment-settlements/${id}/reverse`, { reason }),
  providerBalance: (paymentMethodId: string) =>
    apiClient.get<ProviderBalance>(
      `/payment-settlements/provider-balances${buildQueryString({ paymentMethodId })}`,
    ),
};
