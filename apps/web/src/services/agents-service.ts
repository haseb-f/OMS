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

/** How the agent bears carrier costs (commission-policy.md A3). */
export type AgentShippingPolicy = "PREDETERMINED_CHARGE" | "FLAT_FEE_PER_SHIPMENT" | "NONE";

export interface AgentActiveAgreementRef {
  id: string;
  agreementNumber: string;
  productCommissionRatePercent: string;
  serviceCommissionRatePercent: string;
  shippingPolicy: AgentShippingPolicy;
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

/** Spec 2 (R5) — how a shipment is delivered (from the shipping company type). */
export type TariffDeliveryChannel = "ANY" | "CARRIER" | "INTERNAL_COURIER";
/** Spec 2 (R5) — payment arrangement a tariff applies to. */
export type TariffPaymentType = "ANY" | "PREPAID" | "CASH_ON_DELIVERY";

export interface AgentShippingRate {
  id: string;
  agreementId: string;
  countryId: string;
  city: string;
  deliveryChannel: TariffDeliveryChannel;
  paymentType: TariffPaymentType;
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
  productCommissionRatePercent: string;
  serviceCommissionRatePercent: string;
  shippingPolicy: AgentShippingPolicy;
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
  productCommissionRatePercent: number;
  serviceCommissionRatePercent: number;
  shippingPolicy: AgentShippingPolicy;
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

export type AgentCommissionClass = "PRODUCT" | "SERVICE";
export type AgentCommissionRateSource =
  "AGREEMENT_PRODUCT" | "AGREEMENT_SERVICE" | "ITEM_OVERRIDE" | "LEGACY_SINGLE_RATE";

export interface AgreementPreviewSample {
  productSales?: number;
  serviceSales?: number;
  customerShipping?: number;
}

/** GET /agents/:id/agreements/:agreementId/preview (commission-policy.md A3). */
export interface AgreementPreview {
  agreementId: string;
  agreementNumber: string;
  status: AgentAgreementStatus;
  effectiveFrom: string;
  currency: { code: string; symbol: string | null };
  shippingPolicy: AgentShippingPolicy;
  example: {
    productSales: number;
    serviceSales: number;
    productRatePercent: number;
    serviceRatePercent: number;
    productCommission: number;
    serviceCommission: number;
    totalSales: number;
    totalCommission: number;
    /** Customer shipping collected — company money (A1). */
    customerShipping: number;
    predeterminedShippingCharge: number;
    shippingAppliedToCharge: number;
    shippingDifference: number;
    totalCollected: number;
    companyRetains: number;
    agentEntitlement: number;
  };
  items: Array<{
    id: string;
    sku: string;
    name: string;
    isInventoryItem: boolean;
    itemType: AgentCommissionClass | null;
    /** The explicit item type (null = not classified yet). */
    commissionClass: AgentCommissionClass | null;
    rateSource: AgentCommissionRateSource | null;
    ratePercent: number | null;
    overrideId: string | null;
    /** Why no rate: the item is unclassified, or its type has no rate. */
    missing: "AGENT_ITEM_TYPE_REQUIRED" | "AGENT_COMMISSION_RATE_MISSING" | null;
  }>;
}

/** GET …/commission-report (commission-policy.md A7) — internal workspace and portal. */
export interface AgentCommissionReport {
  agent: AgentRef;
  period: { from: string | null; to: string | null };
  summary: {
    currency: { id: string; code: string; symbol: string | null };
    products: CommissionClassTotals;
    services: CommissionClassTotals;
    legacySingleRate: { sales: number; commission: number; commissionReversed: number };
    totalSales: number;
    /** Shipping/service charges and tax paid by customers (credited with the collection). */
    customerCharges: number;
    returned: number;
    totalCommission: number;
    /** Customer shipping collected (company money) and what was retained from it. */
    customerShipping: number;
    agentShippingCharges: number;
    shippingRetained: number;
    otherCharges: number;
    netEntitlement: number;
    /** Actual carrier cost (company expense) still pending per order — internal report only. */
    carrierCost?: {
      ordersWithEstimateOnly: number;
      ordersAwaitingApproval: number;
    };
  };
  cash: {
    collectedByCompany: number;
    collectedByAgent: number;
    customerRefundsByCompany: number;
    balance: number;
    pending: number;
    availableForPayout: number;
    paidOut: number;
  };
  orders: CommissionReportOrder[];
  lines: CommissionReportLine[];
}

export interface CommissionClassTotals {
  sales: number;
  commissionBase: number;
  commission: number;
  commissionReversed: number;
}

export interface CurrencyAmount {
  currencyCode: string;
  amount: number;
}

export interface CommissionReportOrder {
  storeOrderId: string;
  orderNumber: string;
  earnedAt: string | null;
  dispatchedAt: string | null;
  sales: number;
  customerCharges: number;
  returned: number;
  commissionNet: number;
  shipping: {
    /** Collected from the customer — company money. */
    customerShipping: number;
    /** Predetermined agent shipping charge (PREDETERMINED_CHARGE policy), else null. */
    agentShippingCharge: number | null;
    /** Retained from collected funds; settles the agent shipping charge. */
    retained: number;
    /** O1 — customer − agent charge, borne / kept by the company. Internal report only. */
    difference?: number | null;
    differenceBorneBy?: "COMPANY" | null;
    /** Actual carrier cost — company expense, never an agent deduction. Internal report only. */
    carrier?: CarrierCostStages;
    /** Contractual fee − carrier cost (company shipping margin). Internal report only. */
    margin?: ShippingMargin | null;
  };
  otherCharges: number;
  netEntitlement: number;
}

export interface ShippingMargin {
  amount: number | null;
  basis: "ACTUAL" | "ESTIMATE" | null;
}

export interface CarrierCostStages {
  estimated: number;
  incurredByCurrency: CurrencyAmount[];
  approvedByCurrency: CurrencyAmount[];
  paidByCurrency: CurrencyAmount[];
}

export interface CommissionReportLine {
  storeOrderId: string;
  orderNumber: string;
  productId: string | null;
  sku: string | null;
  name: string | null;
  nameEn: string | null;
  commissionClass: AgentCommissionClass | null;
  rateSource: AgentCommissionRateSource;
  ratePercent: number | null;
  salesAmount: number;
  returnedBeforeEarning: number;
  commissionBase: number | null;
  commission: number;
  commissionReversed: number;
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
    /** commission-policy.md A7 — products vs services (per-line entries). */
    byClass: Record<"PRODUCT" | "SERVICE", { sales: number; base: number; commission: number }>;
    /** Entries earned before per-line detail (single agreement rate). */
    legacySingleRate: number;
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

/** Products tab row (spec 2A): item type, status and the commission in force today. */
export interface AgentProductRow {
  id: string;
  sku: string;
  name: string;
  nameEn: string | null;
  displayName: string;
  itemType: "PRODUCT" | "SERVICE" | null;
  status: "DRAFT" | "ACTIVE" | "INACTIVE";
  isSellable: boolean;
  isInventoryItem: boolean;
  commission: {
    source: "OVERRIDE" | "AGREEMENT" | null;
    ratePercent: number | null;
    /** Why no rate applies (NO_ACTIVE_AGREEMENT, AGENT_ITEM_TYPE_REQUIRED, AGENT_COMMISSION_RATE_MISSING). */
    missing: string | null;
  };
}

export interface AgentProductsResult {
  agreement: { id: string; agreementNumber: string } | null;
  items: AgentProductRow[];
}

export type AgentLinkableProduct = Omit<AgentProductRow, "commission">;

/**
 * Spec 2 (R5) pricing state of an agent order — customer shipping and the
 * contractual agent shipping fee. Shared by the portal and internal screens;
 * never carries carrier cost or margin.
 */
export interface ShippingPricingView {
  status: "NOT_APPLICABLE" | "PENDING_METHOD" | "CONFIRMED";
  provisional: boolean;
  customerTotalStatus: "NONE" | "CONFIRMATION_REQUIRED" | "CONFIRMED";
  pricingMode: "SHIPPING_ADDED" | "SHIPPING_INCLUDED" | null;
  agentShippingFee: {
    amount: number;
    provisional: boolean;
    source: "RATE" | "TARIFF" | "PICKUP" | "DIGITAL_ONLY";
    deliveryChannel: "CARRIER" | "INTERNAL_COURIER" | null;
    paymentType: "PREPAID" | "CASH_ON_DELIVERY" | null;
    resolvedAt: string | null;
  } | null;
  merchandiseAmount: number | null;
  customerShipping: number | null;
  payableTotal: number | null;
  customerTotalChange: {
    previousShippingCharge: number;
    previousPayableTotal: number;
    proposedShippingCharge: number;
    proposedPayableTotal: number;
    requestedAt: string;
    confirmedAt: string | null;
  } | null;
  paidAmount: number;
  outstanding: number | null;
}

/** INTERNAL ONLY — contractual fee vs actual carrier cost → company shipping margin. */
export interface InternalShippingPricing extends ShippingPricingView {
  economics: {
    contractualFee: number | null;
    customerShipping: number | null;
    /** O1 — C − F: negative = the company bears the shortfall, positive = it keeps the excess. */
    difference: { amount: number; borneBy: "COMPANY" } | null;
    carrierCost: { estimate: number; actualByCurrency: CurrencyAmount[] };
    margin: ShippingMargin;
  };
}

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
    /** Rates per agent product + the worked example, shown before Activate (A3). */
    preview: (agentId: string, agreementId: string, sample: AgreementPreviewSample = {}) =>
      apiClient.get<AgreementPreview>(
        `${base}/${agentId}/agreements/${agreementId}/preview${buildQueryString(
          sample as Record<string, unknown>,
        )}`,
      ),
    activate: (agentId: string, agreementId: string) =>
      apiClient.post<AgentAgreement>(`${base}/${agentId}/agreements/${agreementId}/activate`),
    end: (agentId: string, agreementId: string, effectiveTo?: string) =>
      apiClient.post<AgentAgreement>(`${base}/${agentId}/agreements/${agreementId}/end`, {
        effectiveTo,
      }),
    upsertRate: (
      agentId: string,
      agreementId: string,
      dto: {
        countryId: string;
        city?: string;
        deliveryChannel?: TariffDeliveryChannel;
        paymentType?: TariffPaymentType;
        amount: number;
      },
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

  /** Products tab (spec 2A) — link / unlink go through the product update path. */
  products: {
    list: (agentId: string) => apiClient.get<AgentProductsResult>(`${base}/${agentId}/products`),
    linkable: (agentId: string, search?: string) =>
      apiClient.get<AgentLinkableProduct[]>(
        `${base}/${agentId}/products/linkable${buildQueryString({ search })}`,
      ),
    link: (agentId: string, productId: string) =>
      apiClient.post<unknown>(`${base}/${agentId}/products/${productId}/link`),
    unlink: (agentId: string, productId: string) =>
      apiClient.post<unknown>(`${base}/${agentId}/products/${productId}/unlink`),
  },

  /** Agent order shipping pricing (spec 2B) — internal view includes the shipping economics. */
  orderPricing: {
    get: (orderId: string) =>
      apiClient.get<InternalShippingPricing>(`/agent-orders/${orderId}/shipping-pricing`),
    confirmCustomerTotal: (orderId: string, expectedPayableTotal: number) =>
      apiClient.post<InternalShippingPricing>(`/agent-orders/${orderId}/customer-total/confirm`, {
        expectedPayableTotal,
      }),
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
  commissionReport: (agentId: string, params: AgentPeriodParams = {}) =>
    apiClient.get<AgentCommissionReport>(
      `${finance}/agents/${agentId}/commission-report${buildQueryString(params as Record<string, unknown>)}`,
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
