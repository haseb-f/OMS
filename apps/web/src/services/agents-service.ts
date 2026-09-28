import { apiClient } from "./api-client";
import { buildQueryString } from "@/lib/query-string";
import type { StoreOrderListParams, StoreOrderListResult } from "./store-orders-service";

/**
 * Internal (company staff) client for the Agents module
 * (specs/agents-fulfillment-partners §10). Every endpoint here is
 * internal-only — agent tokens are denied server-side.
 */

export type AgentStatus = "ACTIVE" | "INACTIVE";
export type AgentAgreementStatus = "DRAFT" | "ACTIVE" | "ENDED";
export type AgentEarningEvent = "DELIVERED" | "PAYMENT_VERIFIED";
export type AgentReturnTreatment = "REVERSE" | "RETAIN";
export type AgentChargeOwner = "COMPANY" | "AGENT";
export type AgentDestinationOwnership = "COMPANY" | "AGENT";
export type AgentRole = "ADMIN" | "SALES";

export type AgentLedgerEntryType =
  | "COLLECTION_RECEIVED"
  | "COLLECTION_BY_AGENT"
  | "COLLECTION_REVERSAL"
  | "COMMISSION"
  | "COMMISSION_REVERSAL"
  | "CUSTOMER_SHIPPING_RETAINED"
  | "CUSTOMER_SHIPPING_RETAINED_REVERSAL"
  | "SHIPPING_FEE"
  | "RETURN_FEE"
  | "SERVICE_FEE"
  | "PROVIDER_FEE"
  | "CUSTOMER_REFUND"
  | "PAYOUT"
  | "PAYOUT_REVERSAL"
  | "ADJUSTMENT";

export type AgentPostingStatus = "NOT_APPLICABLE" | "PENDING_CONFIGURATION" | "POSTED";

export type AgentPaymentStage =
  | "DECLARED"
  | "REJECTED"
  | "VERIFIED"
  | "COLLECTED_BY_AGENT"
  | "HELD_WITH_PROVIDER"
  | "SETTLED"
  | "PENDING_ELIGIBILITY"
  | "AVAILABLE"
  | "PAID_OUT"
  | "REVERSED";

export interface AgentCurrencyRef {
  id: string;
  code: string;
  name: string;
  symbol?: string | null;
}

export interface AgentRef {
  id: string;
  agentNumber: string;
  name: string;
}

export interface AgentActiveAgreementRef {
  id: string;
  agreementNumber: string;
  commissionRatePercent: string;
  effectiveFrom: string;
  effectiveTo: string | null;
}

export interface AgentRow {
  id: string;
  agentNumber: string;
  name: string;
  legalName: string | null;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  status: AgentStatus;
  currencyId: string;
  currency: AgentCurrencyRef | null;
  partnerId: string;
  createdAt: string;
  updatedAt: string;
  _count: { users: number; products: number; storeOrders: number };
  activeAgreement: AgentActiveAgreementRef | null;
}

export interface AgentShippingRate {
  id: string;
  agreementId: string;
  countryId: string;
  city: string;
  amount: string;
  country: { id: string; code: string; name: string; nameEn: string | null } | null;
}

export interface AgentAgreement {
  id: string;
  agentId: string;
  agreementNumber: string;
  status: AgentAgreementStatus;
  effectiveFrom: string;
  effectiveTo: string | null;
  currencyId: string;
  currency: AgentCurrencyRef | null;
  commissionRatePercent: string;
  commissionEarningEvent: AgentEarningEvent;
  returnCommissionTreatment: AgentReturnTreatment;
  customerShippingChargeOwner: AgentChargeOwner;
  providerFeesBorneBy: AgentChargeOwner;
  shippingFeePerShipment: string;
  returnFeePerShipment: string;
  serviceFeePerOrder: string;
  allowAgentDestinations: boolean;
  payoutHoldDays: number;
  notes: string | null;
  activatedAt: string | null;
  endedAt: string | null;
  createdAt: string;
  shippingRates: AgentShippingRate[];
  _count?: { storeOrders: number };
}

export interface AgentDetail extends Omit<AgentRow, "activeAgreement"> {
  address: string | null;
  notes: string | null;
  partner: { id: string; partnerNumber: string; name: string; status: string } | null;
  activeAgreement: AgentAgreement | null;
  summary: {
    openOrders: number;
    activeDestinations: number;
    agreementsByStatus: Partial<Record<AgentAgreementStatus, number>>;
  };
}

export interface AgentInput {
  name: string;
  legalName?: string;
  contactName?: string;
  phone?: string;
  email?: string | null;
  address?: string;
  notes?: string;
  currencyId: string;
}

/** Every term explicit (decision D3) — the system applies no default. */
export interface AgreementInput {
  effectiveFrom: string;
  effectiveTo?: string;
  commissionRatePercent: number;
  commissionEarningEvent: AgentEarningEvent;
  returnCommissionTreatment: AgentReturnTreatment;
  customerShippingChargeOwner: AgentChargeOwner;
  providerFeesBorneBy: AgentChargeOwner;
  shippingFeePerShipment: number;
  returnFeePerShipment: number;
  serviceFeePerOrder: number;
  allowAgentDestinations: boolean;
  payoutHoldDays: number;
  notes?: string;
}

export interface AgentPaymentDestination {
  id: string;
  agentId: string;
  paymentMethodId: string;
  paymentMethod: { id: string; name: string; isActive: boolean } | null;
  ownership: AgentDestinationOwnership;
  label: string;
  details: string | null;
  isActive: boolean;
  createdAt: string;
}

export interface AgentUserRow {
  id: string;
  email: string;
  username: string;
  fullName: string;
  mobile: string | null;
  isActive: boolean;
  isLocked: boolean;
  mustChangePassword: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  agentRole: AgentRole | null;
  permissions: string[];
}

export interface AgentStockRow {
  productId: string;
  warehouseId: string | null;
  onHand: number;
  reserved: number;
  available: number;
  shipped: number;
  returned: number;
  product: { id: string; name: string; sku?: string | null };
  warehouse: { id: string; name: string; code: string } | null;
}

export interface AgentStockResult {
  agentId: string;
  items: AgentStockRow[];
  totals: {
    onHand: number;
    reserved: number;
    available: number;
    shipped: number;
    returned: number;
  };
}

export interface AgentPosition {
  balance: number;
  pending: number;
  available: number;
  paidOut: number;
}

export interface AgentDashboard {
  agent: AgentRef & { currency: AgentCurrencyRef | null };
  fulfillment: {
    total: number;
    awaitingDispatch: number;
    dispatched: number;
    completed: number;
    withReturns: number;
    cancelled: number;
  };
  sales: {
    merchandiseSalesExShipping: number;
    customerShippingCharges: number;
    totalOrderValue: number;
  };
  returns: { merchandiseReturned: number };
  collections: { awaitingVerificationCount: number; awaitingVerificationAmount: number };
  position: AgentPosition;
  payouts: {
    count: number;
    total: number;
    last: { id: string; payoutNumber: string; amount: string; payoutDate: string } | null;
  };
}

export interface AgentLedgerReferences {
  storeOrderId: string | null;
  orderNumber: string | null;
  paymentId: string | null;
  paymentNumber: string | null;
  payoutId: string | null;
  payoutNumber: string | null;
  settlementId: string | null;
  settlementNumber: string | null;
  returnNumber: string | null;
  journalEntryId: string | null;
  journalEntryNumber: string | null;
}

export interface AgentLedgerLine {
  id: string;
  entryNumber: string;
  entryType: AgentLedgerEntryType;
  entryDate: string;
  description: string;
  debit: number;
  credit: number;
  memoAmount: number | null;
  currencyCode: string | null;
  availableAt: string | null;
  postingStatus: AgentPostingStatus;
  sourceType: string;
  sourceId: string;
  /** Entry facts (rate/base, reason, paidBy, …) — used to render a localized description. */
  basis?: Record<string, unknown> | null;
  references: AgentLedgerReferences;
}

export interface AgentStatementLine extends AgentLedgerLine {
  balance: number;
  memo: boolean;
}

export interface AgentStatementSummary {
  currencyId: string;
  orders: {
    count: number;
    merchandiseSalesExShipping: number;
    customerShippingCharges: number;
    serviceCharges: number;
    totalOrderValue: number;
    discounts: number;
    tax: number;
  };
  returns: { count: number; merchandiseReturned: number };
  refunds: { paidByCompany: number; paidByAgent: number };
  commission: {
    base: number;
    ratePercent: number | null;
    charged: number;
    reversed: number;
    net: number;
  };
  deductions: {
    commission: number;
    customerShippingRetained: number;
    shippingFees: number;
    returnFees: number;
    serviceFees: number;
    providerFees: number;
    customerRefunds: number;
  };
  adjustments: { credit: number; debit: number };
  collections: { byCompany: number; byAgent: number };
  payouts: { paid: number; reversed: number; net: number };
  position: AgentPosition;
}

export interface AgentStatement {
  agent: AgentRef & { legalName: string | null; currency: AgentCurrencyRef | null };
  currency: AgentCurrencyRef | null;
  period: { from: string | null; to: string | null };
  signConvention: string;
  openingBalance: number;
  lines: AgentStatementLine[];
  closingBalance: number;
  totals: { debit: number; credit: number };
  summary: AgentStatementSummary;
}

export interface AgentPeriodParams {
  from?: string;
  to?: string;
}

export interface AgentPendingPosting extends AgentLedgerLine {
  agent: { agentNumber: string; name: string };
}

export interface AgentPayoutRow {
  id: string;
  payoutNumber: string;
  agentId: string;
  status: "CONFIRMED" | "REVERSED";
  amount: number;
  currencyId: string;
  currency: { code: string } | null;
  payingAccountId: string;
  payingAccount: { id: string; name: string } | null;
  payoutDate: string;
  reference: string;
  notes: string | null;
  reversedAt: string | null;
  reversalReason: string | null;
  createdAt: string;
  _count?: { attachments: number; allocations: number };
}

export interface AgentPayoutDetail extends AgentPayoutRow {
  agent: AgentRef;
  allocations: { id: string; ledgerEntryId: string; amount: number }[];
  attachments: {
    id: string;
    attachmentId: string;
    fileName: string;
    mimeType: string;
    sizeBytes: number;
    fileUrl: string;
    createdAt: string;
  }[];
  ledgerEntries: {
    id: string;
    entryNumber: string;
    entryType: AgentLedgerEntryType;
    journalEntryId: string | null;
    postingStatus: AgentPostingStatus;
  }[];
}

export interface AgentPayoutPreview {
  agent: AgentRef;
  currency: AgentCurrencyRef | null;
  balance: number;
  pending: number;
  availableCredits: number;
  deductions: number;
  paidOut: number;
  available: number;
  carriedForwardNegative: number;
  eligibleEntries: {
    id: string;
    entryNumber: string;
    entryType: AgentLedgerEntryType;
    entryDate: string;
    availableAt: string | null;
    credit: number;
    allocated: number;
    remaining: number;
  }[];
  deductionEntries: {
    id: string;
    entryNumber: string;
    entryType: AgentLedgerEntryType;
    entryDate: string;
    debit: number;
  }[];
  accountsConfigured: boolean;
}

export interface CreatePayoutInput {
  amount: number;
  payingAccountId: string;
  payoutDate: string;
  reference: string;
  notes?: string;
  stagedAttachmentIds?: string[];
  idempotencyKey: string;
}

export type AgentCollectionStatusFilter =
  "AWAITING" | "PENDING" | "MATCHED" | "VERIFIED" | "REJECTED" | "DISPUTED";

export interface AgentCollectionRow {
  id: string;
  paymentNumber: string;
  paymentDate: string;
  amount: number;
  status: "PENDING" | "MATCHED" | "VERIFIED" | "REJECTED" | "DISPUTED";
  referenceNumber: string | null;
  senderName: string | null;
  rejectionReason: string | null;
  verifiedAt: string | null;
  createdAt: string;
  currency: { id: string; code: string } | null;
  agent: AgentRef | null;
  agentPaymentDestination: {
    id: string;
    label: string;
    details: string | null;
    ownership: AgentDestinationOwnership;
  } | null;
  paymentMethod: { id: string; name: string } | null;
  storeOrder: {
    id: string;
    internalOrderId: string;
    payableTotal: string | null;
    declaredPaymentStatus: string | null;
    partner: { id: string; name: string } | null;
  } | null;
  attachments: {
    id: string;
    attachmentId: string | null;
    fileName: string | null;
    attachmentType: string | null;
  }[];
  verifiedBy: { id: string; fullName: string } | null;
  rejectedBy: { id: string; fullName: string } | null;
}

export interface AgentCollectionsParams {
  agentId?: string;
  status?: AgentCollectionStatusFilter;
  search?: string;
  page?: number;
  pageSize?: number;
}

export interface AgentPaymentStageRow {
  id: string;
  paymentNumber: string;
  paymentDate: string;
  amount: number;
  status: string;
  destinationOwnership: AgentDestinationOwnership | null;
  stage: AgentPaymentStage;
  availableAt: string | null;
  paidOutAmount: number;
  currency: { code: string } | null;
  paymentMethod: { name: string } | null;
  storeOrder: { id: string; internalOrderId: string } | null;
}

export interface AgentReturnRow {
  id: string;
  returnNumber: string;
  storeOrderId: string;
  warehouseId: string;
  merchandiseAmount: string;
  reason: string | null;
  createdAt: string;
  lines: { storeOrderItemId: string; productId: string; quantity: number }[];
}

export interface ReceiveReturnInput {
  lines: { storeOrderItemId: string; quantity: number }[];
  warehouseId: string;
  reason?: string;
  idempotencyKey: string;
  /** The returned parcel — the return fee is charged once per shipment. */
  shipmentId?: string;
  /** Explicit fee decision (API default: shipment's first receipt, else the order's first receipt). */
  chargeReturnFee?: boolean;
}

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

const base = "/agents";
const finance = "/agent-finance";

export const agentsService = {
  list: (
    params: { search?: string; status?: AgentStatus; page?: number; pageSize?: number } = {},
  ) => apiClient.get<Paged<AgentRow>>(`${base}${buildQueryString(params)}`),
  get: (id: string) => apiClient.get<AgentDetail>(`${base}/${id}`),
  create: (dto: AgentInput) => apiClient.post<AgentDetail>(base, dto),
  update: (id: string, dto: Partial<AgentInput>) =>
    apiClient.patch<AgentDetail>(`${base}/${id}`, dto),
  activate: (id: string) => apiClient.post<AgentDetail>(`${base}/${id}/activate`),
  deactivate: (id: string) => apiClient.post<AgentDetail>(`${base}/${id}/deactivate`),
  archive: (id: string) =>
    apiClient.post<{ id: string; archived: boolean }>(`${base}/${id}/archive`),
  stock: (id: string, params: { productId?: string; warehouseId?: string } = {}) =>
    apiClient.get<AgentStockResult>(`${base}/${id}/stock${buildQueryString(params)}`),
  /**
   * Workspace Orders tab — `GET /agents/:id/orders` (`agents.view`): the Store
   * Orders list filters/row shape, pinned to this agent and not narrowed by the
   * internal sales scope.
   */
  orders: (id: string, params: Omit<StoreOrderListParams, "agentId"> = {}) =>
    apiClient.get<StoreOrderListResult>(
      `${base}/${id}/orders${buildQueryString(params as Record<string, unknown>)}`,
    ),

  agreements: {
    list: (agentId: string) => apiClient.get<AgentAgreement[]>(`${base}/${agentId}/agreements`),
    create: (agentId: string, dto: AgreementInput) =>
      apiClient.post<AgentAgreement>(`${base}/${agentId}/agreements`, dto),
    update: (agentId: string, agreementId: string, dto: Partial<AgreementInput>) =>
      apiClient.patch<AgentAgreement>(`${base}/${agentId}/agreements/${agreementId}`, dto),
    activate: (agentId: string, agreementId: string) =>
      apiClient.post<AgentAgreement>(`${base}/${agentId}/agreements/${agreementId}/activate`),
    end: (agentId: string, agreementId: string, effectiveTo?: string) =>
      apiClient.post<AgentAgreement>(`${base}/${agentId}/agreements/${agreementId}/end`, {
        effectiveTo,
      }),
    upsertRate: (
      agentId: string,
      agreementId: string,
      dto: { countryId: string; city?: string; amount: number },
    ) =>
      apiClient.put<AgentAgreement>(
        `${base}/${agentId}/agreements/${agreementId}/shipping-rates`,
        dto,
      ),
    removeRate: (agentId: string, agreementId: string, rateId: string) =>
      apiClient.delete<AgentAgreement>(
        `${base}/${agentId}/agreements/${agreementId}/shipping-rates/${rateId}`,
      ),
  },

  destinations: {
    list: (agentId: string) =>
      apiClient.get<AgentPaymentDestination[]>(`${base}/${agentId}/payment-destinations`),
    create: (
      agentId: string,
      dto: {
        paymentMethodId: string;
        ownership: AgentDestinationOwnership;
        label: string;
        details?: string;
      },
    ) => apiClient.post<AgentPaymentDestination>(`${base}/${agentId}/payment-destinations`, dto),
    setActive: (agentId: string, destinationId: string, active: boolean) =>
      apiClient.post<AgentPaymentDestination>(
        `${base}/${agentId}/payment-destinations/${destinationId}/${active ? "activate" : "deactivate"}`,
      ),
  },

  users: {
    list: (agentId: string) => apiClient.get<AgentUserRow[]>(`${base}/${agentId}/users`),
    create: (
      agentId: string,
      dto: {
        email: string;
        username: string;
        fullName: string;
        mobile?: string;
        agentRole: AgentRole;
        extraPermissions?: string[];
      },
    ) =>
      apiClient.post<AgentUserRow & { temporaryPassword?: string }>(
        `${base}/${agentId}/users`,
        dto,
      ),
    setPermissions: (agentId: string, userId: string, permissionNames: string[]) =>
      apiClient.put<AgentUserRow>(`${base}/${agentId}/users/${userId}/permissions`, {
        permissionNames,
      }),
    setActive: (agentId: string, userId: string, active: boolean) =>
      apiClient.post<AgentUserRow>(
        `${base}/${agentId}/users/${userId}/${active ? "activate" : "deactivate"}`,
      ),
    resetPassword: (agentId: string, userId: string) =>
      apiClient.post<{ temporaryPassword?: string }>(
        `${base}/${agentId}/users/${userId}/reset-password`,
      ),
  },
};

export const agentFinanceService = {
  collections: (params: AgentCollectionsParams = {}) =>
    apiClient.get<Paged<AgentCollectionRow>>(
      `${finance}/collections${buildQueryString(params as Record<string, unknown>)}`,
    ),
  verifyCollection: (paymentId: string) =>
    apiClient.post<unknown>(`${finance}/collections/${paymentId}/verify`),
  rejectCollection: (paymentId: string, reason: string) =>
    apiClient.post<unknown>(`${finance}/collections/${paymentId}/reject`, { reason }),

  ledger: (
    agentId: string,
    params: AgentPeriodParams & { page?: number; pageSize?: number } = {},
  ) =>
    apiClient.get<Paged<AgentLedgerLine>>(
      `${finance}/agents/${agentId}/ledger${buildQueryString(params as Record<string, unknown>)}`,
    ),
  statement: (agentId: string, params: AgentPeriodParams = {}) =>
    apiClient.get<AgentStatement>(
      `${finance}/agents/${agentId}/statement${buildQueryString(params as Record<string, unknown>)}`,
    ),
  statementPrint: (agentId: string, params: AgentPeriodParams = {}) =>
    apiClient.get<AgentStatement>(
      `${finance}/agents/${agentId}/statement/print${buildQueryString(params as Record<string, unknown>)}`,
    ),
  dashboard: (agentId: string) =>
    apiClient.get<AgentDashboard>(`${finance}/agents/${agentId}/dashboard`),
  paymentStages: (agentId: string, storeOrderId?: string) =>
    apiClient.get<AgentPaymentStageRow[]>(
      `${finance}/agents/${agentId}/payments${buildQueryString({ storeOrderId })}`,
    ),

  pendingPostings: (agentId?: string) =>
    apiClient.get<{ items: AgentPendingPosting[]; total: number }>(
      `${finance}/pending-postings${buildQueryString({ agentId })}`,
    ),
  postPending: (agentId?: string) =>
    apiClient.post<unknown>(`${finance}/pending-postings/post`, agentId ? { agentId } : {}),

  payouts: (agentId: string, params: { page?: number; pageSize?: number } = {}) =>
    apiClient.get<Paged<AgentPayoutRow>>(
      `${finance}/agents/${agentId}/payouts${buildQueryString(params)}`,
    ),
  payoutPreview: (agentId: string) =>
    apiClient.get<AgentPayoutPreview>(`${finance}/agents/${agentId}/payouts/preview`),
  createPayout: (agentId: string, dto: CreatePayoutInput) =>
    apiClient.post<AgentPayoutDetail>(`${finance}/agents/${agentId}/payouts`, dto),
  payoutDetail: (payoutId: string) =>
    apiClient.get<AgentPayoutDetail>(`${finance}/payouts/${payoutId}`),
  reversePayout: (payoutId: string, reason: string) =>
    apiClient.post<AgentPayoutDetail>(`${finance}/payouts/${payoutId}/reverse`, { reason }),

  /** Customer refund on an agent order — bounded server-side by what was collected (company vs agent). */
  refund: (orderId: string, dto: AgentRefundInput) =>
    apiClient.post<unknown>(`${finance}/orders/${orderId}/refunds`, dto),
  /** Finance adjustment on the agent ledger (CREDIT = we owe the agent more; DEBIT = less). */
  adjust: (agentId: string, dto: AgentAdjustmentInput) =>
    apiClient.post<unknown>(`${finance}/agents/${agentId}/adjustments`, dto),
};

export interface AgentRefundInput {
  amount: number;
  /** COMPANY = paid from our receiving account (needs `payingAccountId`); AGENT = the agent refunded directly (memo). */
  paidBy: AgentChargeOwner;
  payingAccountId?: string;
  reason: string;
  refundDate?: string;
  idempotencyKey: string;
}

export interface AgentAdjustmentInput {
  direction: "DEBIT" | "CREDIT";
  amount: number;
  reason: string;
  storeOrderId?: string;
  entryDate?: string;
  idempotencyKey: string;
}

export const agentReturnsService = {
  list: (orderId: string) => apiClient.get<AgentReturnRow[]>(`/agent-returns/orders/${orderId}`),
  receive: (orderId: string, dto: ReceiveReturnInput) =>
    apiClient.post<unknown>(`/agent-returns/orders/${orderId}`, dto),
};
