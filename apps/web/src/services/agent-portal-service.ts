import type { DuplicateResolution } from "./order-duplicates-service";
import { apiClient } from "./api-client";
import { orderAmendmentsClient } from "./order-amendments-service";
import { buildQueryString as buildQuery } from "@/lib/query-string";
import type {
  AgentCommissionReport,
  ShippingPricingView,
  TariffDeliveryChannel,
  TariffPaymentType,
} from "./agents-service";

/**
 * External agent portal API (`/agent-portal/*`, specs/agents-fulfillment-partners §3, §10).
 * Every call runs under the agent user's own token; the agent id is always
 * derived server-side, never sent from here.
 */

export type AgentPortalRole = "ADMIN" | "SALES";
export type PricingMode = "SHIPPING_ADDED" | "SHIPPING_INCLUDED";
export type FulfillmentMethod = "SHIPPING" | "PICKUP";
export type PaymentType = "PREPAID" | "CASH_ON_DELIVERY";
export type ShippingChargeSource = "NONE" | "RATE" | "MANUAL";
export type DestinationOwnership = "COMPANY" | "AGENT";
export type DeclaredPaymentStatus = "UNPAID" | "PARTIALLY_PAID" | "PAID";
export type FinancePaymentStatus =
  | "PAYMENT_PENDING"
  | "PARTIALLY_PAID"
  | "FULLY_PAID_RECONCILED"
  | "OVERPAID"
  | "UNMATCHED"
  | "PAYMENT_REVIEW";
export type ClaimVerification =
  "DECLARED_AWAITING_FINANCE" | "FINANCE_MATCHED" | "FINANCE_VERIFIED" | "REJECTED" | "DISPUTED";
export type PortalPaymentStage =
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
export type PortalEntryType =
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

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface CurrencyRef {
  id: string;
  code: string;
  name?: string;
}

export interface CountryRef {
  id: string;
  name: string;
  nameEn: string | null;
  code?: string;
}

export interface CatalogStatus {
  code: string;
  name: string;
  nameEn: string | null;
  color: string | null;
}

// ── Profile / dashboard ───────────────────────────────────────────────────

export interface PortalShippingRate {
  country: CountryRef & { code: string };
  city: string | null;
  deliveryChannel: TariffDeliveryChannel;
  paymentType: TariffPaymentType;
  amount: number;
}

export interface PortalMe {
  user: {
    id: string;
    fullName: string;
    username: string;
    email: string;
    agentRole: AgentPortalRole | null;
    permissions: string[];
  };
  agent: {
    id: string;
    agentNumber: string;
    name: string;
    legalName: string | null;
    status: "ACTIVE" | "INACTIVE";
    currency: CurrencyRef;
  };
  agreement: {
    agreementNumber: string;
    effectiveFrom: string;
    effectiveTo: string | null;
    currencyId: string;
    productCommissionRatePercent: number;
    serviceCommissionRatePercent: number;
    shippingPolicy: "PREDETERMINED_CHARGE" | "FLAT_FEE_PER_SHIPMENT" | "NONE";
    allowAgentDestinations: boolean;
    shippingRates: PortalShippingRate[];
  } | null;
}

export interface PortalFulfillmentCounts {
  total: number;
  awaitingDispatch: number;
  dispatched: number;
  completed: number;
  withReturns: number;
  cancelled: number;
}

export interface PortalDashboard {
  scope: "OWN" | "ALL";
  agent: { id: string; agentNumber: string; name: string; currency: CurrencyRef };
  fulfillment: PortalFulfillmentCounts;
  sales: {
    merchandiseSalesExShipping: number;
    customerShippingCharges: number;
    totalOrderValue: number;
  } | null;
  returns: { merchandiseReturned: number } | null;
  collections: { awaitingVerificationCount: number; awaitingVerificationAmount: number } | null;
  position: { balance: number; pending: number; available: number; paidOut: number } | null;
  payouts: {
    count: number;
    total: number;
    last: { id: string; payoutNumber: string; amount: number | string; payoutDate: string } | null;
  } | null;
}

// ── Products / stock / destinations ───────────────────────────────────────

export interface PortalProduct {
  id: string;
  sku: string;
  name: string;
  nameEn: string | null;
  displayName: string | null;
  type: string;
  isInventoryItem: boolean;
  listPrice: number | null;
  unit: { id: string; name: string } | null;
  available: number | null;
}

export interface PortalProductsPage extends Paged<PortalProduct> {
  stockVisible: boolean;
}

export interface PortalStockRow {
  productId: string;
  warehouseId: string | null;
  onHand: number;
  reserved: number;
  available: number;
  shipped: number;
  returned: number;
  product: {
    id: string;
    sku: string;
    name: string;
    nameEn: string | null;
    displayName: string | null;
  };
  warehouse: { id: string; name: string; code: string } | null;
}

export interface PortalStock {
  items: PortalStockRow[];
  totals: {
    onHand: number;
    reserved: number;
    available: number;
    shipped: number;
    returned: number;
  };
}

export interface PortalDestination {
  id: string;
  label: string;
  ownership: DestinationOwnership;
  details: string | null;
  method: { id: string; name: string };
}

// ── Leads ─────────────────────────────────────────────────────────────────

export interface PortalLead {
  id: string;
  leadNumber: string;
  customerName: string;
  mobileNumber: string;
  city: string | null;
  address: string | null;
  quantity: number | null;
  fulfillmentMethod: FulfillmentMethod | null;
  createdAt: string;
  salesEmployee: { id: string; fullName: string } | null;
  country: (CountryRef & { code: string }) | null;
  product: { id: string; name: string; displayName: string | null; sku: string } | null;
  status: CatalogStatus & { id: string };
  storeOrder: { id: string; internalOrderId: string } | null;
  /** R6 — follow-up classification (latest outcome code), read-only for agents. */
  followUpOutcome: string | null;
  followUpOutcomeAt: string | null;
}

export interface PortalLeadInput {
  customerName: string;
  mobileNumber: string;
  countryId: string;
  city?: string;
  address?: string;
  productId?: string;
  quantity?: number;
  fulfillmentMethod?: FulfillmentMethod;
}

// ── Orders ────────────────────────────────────────────────────────────────

export interface PricingLineInput {
  productId: string;
  quantity: number;
  lineAmount?: number;
}

export interface PricingInput {
  pricingMode: PricingMode;
  lines: PricingLineInput[];
  agreedTotal?: number;
  fulfillmentMethod?: FulfillmentMethod;
  paymentType?: PaymentType;
  countryId?: string;
  city?: string;
  address?: string;
  shippingChargeOverride?: number;
  shippingOverrideReason?: string;
  serviceCharge?: number;
}

export interface CreateOrderInput extends PricingInput {
  customer: { name: string; mobile?: string; countryId?: string; city?: string; address?: string };
  notes?: string;
  idempotencyKey: string;
  /** Round 5 Spec 1B — the answer to the duplicate customer warning. */
  duplicateResolution?: DuplicateResolution;
}

export interface ConvertLeadInput extends PricingInput {
  notes?: string;
  /** Spec 1B — one key per form instance. */
  idempotencyKey?: string;
  duplicateResolution?: DuplicateResolution;
}

export interface QuoteIssue {
  code: string;
  message: string;
  lineKey?: string;
}

export interface OrderQuote {
  valid: boolean;
  issues: QuoteIssue[];
  currencyId: string | null;
  fulfillmentMethod: FulfillmentMethod;
  paymentType: PaymentType;
  digitalOnly: boolean;
  shipping: {
    rate: number | null;
    rateScope: "CITY" | "COUNTRY" | null;
    charge: number | null;
    source: ShippingChargeSource | null;
    overrideAllowed: boolean;
  };
  lines: Array<{
    productId: string;
    name: string | null;
    quantity: number;
    listUnitPrice: number | null;
    isInventoryItem: boolean;
    lineAmount?: number;
    unitPrice?: number;
    discountAmount?: number;
  }>;
  breakdown: {
    mode: PricingMode;
    merchandiseAmount: number;
    discountAmount: number;
    taxAmount: number;
    shippingCharge: number;
    serviceCharge: number;
    payableTotal: number;
  } | null;
  /** Spec 2 — PENDING_METHOD: the shipping fee is a provisional estimate. */
  shippingPricingStatus: ShippingPricingView["status"];
}

export interface OrderBreakdown {
  mode: PricingMode | null;
  merchandiseAmount: number | null;
  discountAmount: number | null;
  taxAmount: number | null;
  shippingCharge: number | null;
  shippingChargeSource?: ShippingChargeSource | null;
  shippingRateAmount?: number | null;
  shippingOverrideReason?: string | null;
  serviceCharge: number | null;
  payableTotal: number;
}

export interface PortalOrderRow {
  id: string;
  internalOrderId: string;
  orderDate: string;
  createdAt: string;
  customer: { name: string; mobile: string | null } | null;
  owner: { id: string; fullName: string } | null;
  fulfillmentMethod: FulfillmentMethod;
  paymentType: PaymentType;
  currency: CurrencyRef | null;
  itemCount: number;
  breakdown: OrderBreakdown;
  shippingPricingStatus: ShippingPricingView["status"];
  customerTotalStatus: ShippingPricingView["customerTotalStatus"];
  declaredPaymentStatus: DeclaredPaymentStatus;
  declaredAmount: number;
  financePaymentStatus: FinancePaymentStatus;
  paymentDiscrepancy: boolean;
  fulfillmentStatus: CatalogStatus | null;
  dispatchedAt: string | null;
  earnedAt: string | null;
}

export interface PortalOrdersQuery {
  page?: number;
  pageSize?: number;
  search?: string;
  declaredPaymentStatus?: DeclaredPaymentStatus;
  paymentStatus?: FinancePaymentStatus;
  fulfillmentStatusCode?: string;
  fulfillmentMethod?: FulfillmentMethod;
  from?: string;
  to?: string;
}

export interface PortalFile {
  attachmentId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
  fileUrl: string;
}

export interface PortalClaim {
  id: string;
  paymentNumber: string;
  paymentDate: string;
  declaredAt: string;
  amount: number;
  currencyCode: string;
  declarationKind: "FULL" | "PARTIAL" | null;
  reference: string | null;
  verification: ClaimVerification;
  verifiedAt: string | null;
  rejectedAt: string | null;
  rejectionReason: string | null;
  destination: { id: string; label: string; ownership: DestinationOwnership } | null;
  ownership: DestinationOwnership | null;
  method: { id: string; name: string } | null;
  stage: PortalPaymentStage | null;
  availableAt: string | null;
  paidOutAmount: number;
  attachments: PortalFile[];
}

export interface PortalOrderDetail {
  id: string;
  internalOrderId: string;
  /** Spec 1A — optimistic concurrency version (amendments). */
  version: number;
  orderDate: string;
  createdAt: string;
  owner: { id: string; fullName: string } | null;
  lead: { id: string; leadNumber: string } | null;
  customer: {
    name: string;
    mobile: string | null;
    city: string | null;
    address: string | null;
    country: CountryRef | null;
  } | null;
  fulfillmentMethod: FulfillmentMethod;
  paymentType: PaymentType;
  currency: CurrencyRef | null;
  lines: Array<{
    id: string;
    product: {
      id: string;
      sku: string;
      name: string;
      nameEn: string | null;
      displayName: string | null;
      isInventoryItem: boolean;
    };
    quantity: number;
    unitPrice: number;
    lineAmount: number;
  }>;
  breakdown: OrderBreakdown;
  /** Spec 2 — customer shipping + contractual fee (never carrier cost or margin). */
  shippingPricing: ShippingPricingView;
  payment: {
    declaredPaymentStatus: DeclaredPaymentStatus;
    declaredAmount: number;
    financeVerifiedAmount: number;
    financeMatchedAmount: number;
    financePaymentStatus: FinancePaymentStatus;
    paymentDiscrepancy: boolean;
    paymentDiscrepancyReason: string | null;
    remainingToDeclare: number;
    claims: PortalClaim[];
  };
  fulfillment: {
    status: CatalogStatus | null;
    shippingStage: string | null;
    dispatchedAt: string | null;
    earnedAt: string | null;
    /** No inventory line: nothing ships — the order completes once earned. */
    digitalOnly?: boolean;
    shipments: Array<{
      id: string;
      attemptNumber: number;
      status: string | null;
      carrierStatus: { code: string; name: string; color: string | null } | null;
      shippingCompany: { id: string; name: string } | null;
      trackingNumber: string | null;
      isReship: boolean;
      createdAt: string;
      updatedAt: string;
    }>;
  };
  returns: Array<{
    id: string;
    returnNumber: string;
    createdAt: string;
    merchandiseAmount: number;
    reason: string | null;
  }>;
  timeline: Array<{ at: string; event: string; reference?: string }>;
}

export interface DeclarationInput {
  kind: "UNPAID" | "FULL" | "PARTIAL";
  amount?: number;
  destinationId?: string;
  paymentDate?: string;
  reference?: string;
  stagedAttachmentIds?: string[];
  idempotencyKey: string;
}

// ── Statement / payouts ───────────────────────────────────────────────────

export interface PortalStatementLine {
  id: string;
  entryNumber: string;
  entryType: PortalEntryType;
  entryDate: string;
  description: string;
  debit: number;
  credit: number;
  memoAmount: number | null;
  memo: boolean;
  balance: number;
  /** Portal-safe entry facts — used to render a localized description. */
  basis?: Record<string, unknown> | null;
  currencyCode: string | null;
  availableAt: string | null;
  references: {
    storeOrderId: string | null;
    orderNumber: string | null;
    paymentNumber: string | null;
    payoutId: string | null;
    payoutNumber: string | null;
    settlementNumber: string | null;
    returnNumber: string | null;
  };
}

export interface PortalStatementSummary {
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
  position: { balance: number; pending: number; available: number; paidOut: number };
}

export interface PortalStatement {
  agent: { id: string; agentNumber: string; name: string; legalName: string | null };
  currency: CurrencyRef | null;
  period: { from: string | null; to: string | null };
  signConvention: string;
  openingBalance: number;
  lines: PortalStatementLine[];
  closingBalance: number;
  totals: { debit: number; credit: number };
  summary: PortalStatementSummary;
}

export interface PortalStatementPrintData extends PortalStatement {
  document: {
    kind: "AGENT_STATEMENT";
    orientation: "landscape" | "portrait";
    printedAt: string;
    printedBy: string | null;
  };
}

export interface PortalPayoutRow {
  id: string;
  payoutNumber: string;
  status: "CONFIRMED" | "REVERSED";
  amount: number;
  currency: { code: string } | null;
  payoutDate: string;
  reference: string | null;
  payingAccount: { name: string } | null;
  reversedAt: string | null;
  attachmentCount: number;
  allocationCount: number;
}

export interface PortalPayoutDetail {
  id: string;
  payoutNumber: string;
  status: "CONFIRMED" | "REVERSED";
  amount: number;
  currency: { code: string } | null;
  payoutDate: string;
  reference: string | null;
  payingAccount: { name: string } | null;
  reversedAt: string | null;
  reversalReason: string | null;
  allocations: Array<{
    amount: number;
    entryNumber: string;
    entryType: PortalEntryType;
    description: string;
    storeOrderId: string | null;
    orderNumber: string | null;
  }>;
  attachments: PortalFile[];
}

// ── Team ──────────────────────────────────────────────────────────────────

export interface PortalTeamUser {
  id: string;
  email: string;
  username: string;
  fullName: string;
  mobile: string | null;
  isActive: boolean;
  isLocked: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  agentRole: AgentPortalRole | null;
  permissions: string[];
  temporaryPassword?: string;
}

export interface PortalTeamUserInput {
  fullName: string;
  username: string;
  email: string;
  mobile?: string;
  permissionNames?: string[];
}

export interface StatementQuery {
  from?: string;
  to?: string;
}

const BASE = "/agent-portal";

export const agentPortalService = {
  me: () => apiClient.get<PortalMe>(`${BASE}/me`),
  dashboard: () => apiClient.get<PortalDashboard>(`${BASE}/dashboard`),
  products: (query: { search?: string; page?: number; pageSize?: number } = {}) =>
    apiClient.get<PortalProductsPage>(`${BASE}/products${buildQuery(query)}`),
  stock: () => apiClient.get<PortalStock>(`${BASE}/stock`),
  /** Every active country (lead / order destinations). */
  countries: () => apiClient.get<Array<CountryRef & { code: string }>>(`${BASE}/countries`),
  paymentDestinations: () => apiClient.get<PortalDestination[]>(`${BASE}/payment-destinations`),
  /** Evidence file through the portal's own authorization (never the internal attachments route). */
  downloadFile: (fileUrl: string) => apiClient.getBlob(fileUrl),

  leads: {
    list: (query: { search?: string; statusCode?: string; page?: number; pageSize?: number }) =>
      apiClient.get<Paged<PortalLead>>(`${BASE}/leads${buildQuery(query)}`),
    get: (id: string) => apiClient.get<PortalLead>(`${BASE}/leads/${id}`),
    create: (input: PortalLeadInput) => apiClient.post<PortalLead>(`${BASE}/leads`, input),
    convert: (id: string, input: ConvertLeadInput) =>
      apiClient.post<PortalOrderDetail>(`${BASE}/leads/${id}/convert`, input),
  },

  orders: {
    quote: (input: PricingInput) => apiClient.post<OrderQuote>(`${BASE}/orders/quote`, input),
    /** The idempotency key travels in the body (the API accepts body or header); a retry returns the first order. */
    create: (input: CreateOrderInput) => apiClient.post<PortalOrderDetail>(`${BASE}/orders`, input),
    list: (query: PortalOrdersQuery) =>
      apiClient.get<Paged<PortalOrderRow>>(`${BASE}/orders${buildQuery({ ...query })}`),
    get: (id: string) => apiClient.get<PortalOrderDetail>(`${BASE}/orders/${id}`),
    declare: (id: string, input: DeclarationInput) =>
      apiClient.post<PortalOrderDetail>(`${BASE}/orders/${id}/payment-declaration`, input),
    /** Round 5 Spec 1A — guided amendments (`agent.orders.edit`). */
    amendments: orderAmendmentsClient<PortalOrderDetail>(`${BASE}/orders`),
    /** Spec 2 — "Customer agreed to pay {total}" (order owner / agent admin). */
    confirmCustomerTotal: (id: string, expectedPayableTotal: number) =>
      apiClient.post<PortalOrderDetail>(`${BASE}/orders/${id}/customer-total/confirm`, {
        expectedPayableTotal,
      }),
  },

  /** Item-level commission and shipping settlement (commission-policy.md A7). */
  commissionReport: (query: StatementQuery) =>
    apiClient.get<AgentCommissionReport>(`${BASE}/commission-report${buildQuery({ ...query })}`),
  statement: (query: StatementQuery) =>
    apiClient.get<PortalStatement>(`${BASE}/statement${buildQuery({ ...query })}`),
  statementPrintData: (query: StatementQuery) =>
    apiClient.get<PortalStatementPrintData>(
      `${BASE}/statement/print-data${buildQuery({ ...query })}`,
    ),

  payouts: {
    list: (query: { page?: number; pageSize?: number }) =>
      apiClient.get<Paged<PortalPayoutRow>>(`${BASE}/payouts${buildQuery(query)}`),
    get: (id: string) => apiClient.get<PortalPayoutDetail>(`${BASE}/payouts/${id}`),
  },

  team: {
    list: () => apiClient.get<PortalTeamUser[]>(`${BASE}/team`),
    create: (input: PortalTeamUserInput) => apiClient.post<PortalTeamUser>(`${BASE}/team`, input),
    setPermissions: (userId: string, permissionNames: string[]) =>
      apiClient.put<PortalTeamUser>(`${BASE}/team/${userId}/permissions`, { permissionNames }),
    activate: (userId: string) => apiClient.post<PortalTeamUser>(`${BASE}/team/${userId}/activate`),
    deactivate: (userId: string) =>
      apiClient.post<PortalTeamUser>(`${BASE}/team/${userId}/deactivate`),
    resetPassword: (userId: string) =>
      apiClient.post<PortalTeamUser>(`${BASE}/team/${userId}/reset-password`),
  },
};
