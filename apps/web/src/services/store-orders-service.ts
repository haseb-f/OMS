import type { DuplicateResolution, DuplicateReviewStatus } from "./order-duplicates-service";
import { apiClient } from "./api-client";
import { orderAmendmentsClient } from "./order-amendments-service";
import { buildQueryString } from "@/lib/query-string";

/** ADR-0018 — completeness of a cost component (or the Order overall). Never treat a missing value as 0 without reading this. */
export type CostState = "COMPLETE" | "PARTIAL" | "UNKNOWN";

export interface OrderEconomicsItemLine {
  productId: string;
  quantity: number;
  netRevenue: number;
  historicalUnitCost: number | null;
  cogs: number | null;
}

/** ADR-0018 (M2 gap closure) — CONFIRMED_ACTUAL (a reconciled carrier charge) always wins over ACTUAL (the Shipment's own operationally-entered cost) over UNKNOWN. No ESTIMATED tier — no shipping-estimate data source exists. */
export type ShippingCostSource = "CONFIRMED_ACTUAL" | "ACTUAL" | "UNKNOWN";

export interface ShipmentAttemptCost {
  shipmentId: string;
  attemptNumber: number;
  status: string | null;
  baseShippingCost: number | null;
  additionalShippingCost: number | null;
  operationalCost: number | null;
  confirmedCarrierCost: number | null;
  costVariance: number | null;
  costSource: ShippingCostSource;
  totalCost: number | null;
}

/** ADR-0018 (M2.2) — ACTUAL (Payment.actualFeeAmount) always wins over ESTIMATED (PaymentSource fee config) over UNKNOWN. */
export type PaymentFeeSource = "ACTUAL" | "ESTIMATED" | "UNKNOWN";

export interface PaymentFeeLine {
  paymentId: string;
  amount: number;
  feeAmount: number | null;
  feeSource: PaymentFeeSource;
}

export type FulfillmentCostSource = "STANDARD" | "ACTUAL";

export interface OrderEconomics {
  storeOrderId: string;
  netRevenue: number;
  items: OrderEconomicsItemLine[];
  cogs: number;
  cogsState: CostState;
  grossProductProfit: number;
  grossMarginPercent: number | null;
  shippingAttempts: ShipmentAttemptCost[];
  shippingCost: number;
  shippingState: CostState;
  payments: PaymentFeeLine[];
  paymentFeeCost: number;
  paymentFeeState: CostState;
  fulfillmentCost: number;
  fulfillmentCostState: CostState;
  fulfillmentCostSource: FulfillmentCostSource | null;
  fulfillmentCostRuleName: string | null;
  totalDirectCost: number;
  contributionProfit: number;
  contributionMarginPercent: number | null;
  costState: CostState;
}

/** Every Prisma `StoreOrderSource` value (lead conversions keep EXCEL / GOOGLE_SHEETS). */
export const STORE_ORDER_SOURCE_VALUES = ["MANUAL", "IMPORT", "EXCEL", "GOOGLE_SHEETS"] as const;
export type StoreOrderSourceValue = (typeof STORE_ORDER_SOURCE_VALUES)[number];

export type StoreOrderPaymentStatusValue =
  | "PAYMENT_PENDING"
  | "PARTIALLY_PAID"
  | "FULLY_PAID_RECONCILED"
  | "OVERPAID"
  | "UNMATCHED"
  | "PAYMENT_REVIEW";

export type StoreOrderPaymentTypeValue = "PREPAID" | "CASH_ON_DELIVERY";
export type StoreOrderFulfillmentMethodValue = "SHIPPING" | "PICKUP";

export type StoreOrderShippingStageValue = "NOT_READY" | "READY_FOR_SHIPPING";

/** What Sales/Finance DECLARED — never Finance verification (see `paymentStatus`). */
export type StoreOrderDeclaredPaymentStatusValue = "UNPAID" | "PARTIALLY_PAID" | "PAID";
export type PaymentOriginValue =
  "LEGACY" | "SALES_DECLARATION" | "FINANCE_DECLARATION" | "LEAD_CONVERSION";
export type PaymentSettlementStatusValue =
  "NOT_APPLICABLE" | "AWAITING_SETTLEMENT" | "PARTIALLY_SETTLED" | "SETTLED";
export type PickupTransitionCode = "READY_FOR_PICKUP" | "COLLECTED" | "CANCELLED" | "RETURNED";

export interface PaymentDeclarationInput {
  kind: "UNPAID" | "FULL" | "PARTIAL";
  amount?: number;
  paymentMethodId?: string;
  currencyId?: string;
  paymentDate?: string;
  referenceNumber?: string;
  stagedAttachmentIds?: string[];
}

export interface PaymentDeclarationResult {
  payment: StoreOrderPaymentRow | null;
  /** False when the idempotency key had already produced this claim (a retry). */
  created: boolean;
  declaredPaymentStatus: StoreOrderDeclaredPaymentStatusValue;
  declaredAmount: string;
  order: StoreOrderRow;
}

export interface FulfillmentGateResult {
  allowed: boolean;
  settlementMode: "COD" | "PREPAID";
  basis: "COD" | "DECLARED_PAID" | "VERIFIED_PAID" | null;
  reason: string | null;
}

export interface StoreOrderPartnerRef {
  id: string;
  partnerNumber?: string;
  name: string;
  phone: string | null;
  mobile?: string | null;
  email?: string | null;
  address?: string | null;
  city?: string | null;
  countryId?: string | null;
}

export interface StoreOrderItemRow {
  id: string;
  productId: string;
  product?: { id: string; name: string; sku: string } | null;
  quantity: number;
  unitPrice: string;
  agreedAmount?: string;
}

export interface StoreOrderPaymentAttachmentRow {
  id: string;
  attachmentId: string | null;
  fileName: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  source: "UPLOAD" | "URL";
  fileUrl: string;
  uploadedBy: string | null;
  createdAt: string;
}

export interface StoreOrderPaymentRow {
  id: string;
  paymentNumber: string;
  amount: string;
  status: string;
  paymentDate: string;
  referenceNumber?: string | null;
  paymentSource?: { id?: string; name: string } | null;
  paymentMethod?: { id: string; name: string; requiresReconciliation?: boolean } | null;
  origin?: PaymentOriginValue;
  declarationKind?: "FULL" | "PARTIAL" | null;
  disputeReason?: string | null;
  rejectionReason?: string | null;
  settlementStatus?: PaymentSettlementStatusValue;
  receiptLink?: { financialTransactionId: string } | null;
  attachments?: StoreOrderPaymentAttachmentRow[];
  /** ADR-0018 (M2.2) — the ACTUAL provider transaction fee, once reconciled. Null means not recorded yet. */
  actualFeeAmount?: string | null;
}

export interface StoreOrderReceiptRow {
  id: string;
  paymentId?: string | null;
  attachmentId?: string | null;
  fileUrl: string;
  fileName: string | null;
  mimeType?: string | null;
  fileSizeBytes?: number | null;
  source?: "UPLOAD" | "URL";
  createdAt: string;
  createdBy: string | null;
}

export interface StoreOrderShipmentRow {
  id: string;
  storeOrderId: string;
  attemptNumber: number;
  shippingCompanyId: string | null;
  shippingCompany?: { id: string; name: string } | null;
  trackingNumber: string | null;
  labelUrl: string | null;
  status: ShipmentStatusValue;
  shippingStatus?: {
    id: string;
    code: string;
    name: string;
    color: string;
    syncBehavior?: "UNDER_SYNC" | "FINAL";
  } | null;
  labelCreatedAt: string | null;
  shippedAt: string | null;
  outForDeliveryAt: string | null;
  deliveredAt: string | null;
  deliveryFailedAt: string | null;
  shippingCost: string | null;
  notes: string | null;
  createdAt: string;
  /** Spec 1A — the order was amended after this label was issued: cancel and reissue it. */
  labelReissueRequired?: boolean;
}

/** Shipping operational evidence (receipt/waybill/handover proof) — never a Payment Receipt (see StoreOrderReceiptRow/PaymentAttachmentRow). */
export interface ShipmentAttachmentRow {
  id: string;
  attachmentId: string | null;
  fileName: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  fileUrl: string;
  attachmentType: string;
  uploadedBy: string | null;
  createdAt: string;
}

export type ShipmentStatusValue =
  | "READY_FOR_SHIPPING"
  | "LABEL_CREATED"
  | "SHIPPED"
  | "OUT_FOR_DELIVERY"
  | "DELIVERED"
  | "DELIVERY_FAILED"
  | "NEEDS_RESHIPMENT";

export interface StoreOrderActivityEntry {
  id: string;
  action: string;
  details: string | null;
  performedBy: string | null;
  createdAt: string;
}

export interface StoreOrderRow {
  id: string;
  internalOrderId: string;
  externalOrderId: string | null;
  partnerId: string;
  partner?: StoreOrderPartnerRef | null;
  leadId?: string | null;
  orderDate: string;
  source: StoreOrderSourceValue;
  sourceChannel: string | null;
  employeeId: string | null;
  employee?: { id: string; fullName: string } | null;
  paymentStatus: StoreOrderPaymentStatusValue;
  paymentType: StoreOrderPaymentTypeValue;
  declaredPaymentStatus?: StoreOrderDeclaredPaymentStatusValue;
  declaredAmount?: string;
  paymentDiscrepancy?: boolean;
  paymentDiscrepancyReason?: string | null;
  fulfillmentStatus?: { id: string; code: string; name: string; nameEn?: string | null } | null;
  fulfillmentMethod?: StoreOrderFulfillmentMethodValue;
  shippingStage: StoreOrderShippingStageValue;
  shippingStatus?: { id: string; code: string; name: string; color: string } | null;
  currency: { id: string; code: string; name: string; symbol: string | null } | null;
  currencyId: string;
  notes: string | null;
  items: StoreOrderItemRow[];
  payments?: StoreOrderPaymentRow[];
  receipts?: StoreOrderReceiptRow[];
  shipments?: StoreOrderShipmentRow[];
  invoices?: { id: string; invoiceNumber: string; status: string; grandTotal: string }[];
  total?: string;
  createdAt: string;
  updatedAt: string;
  /** ADR-0018 (M2 gap closure) — present only when the list was fetched with `includeProfitability: true` AND the caller holds `orders.profitability.view`. */
  profitability?: OrderEconomics | null;
  /** Agents milestone — the owner agent (null = company order). */
  agentId?: string | null;
  agent?: { id: string; name: string; agentNumber: string } | null;
  /** Agents milestone (spec §5) — explicit price breakdown; null on legacy orders. */
  pricingMode?: "SHIPPING_ADDED" | "SHIPPING_INCLUDED" | null;
  merchandiseAmount?: string | null;
  discountAmount?: string | null;
  taxAmount?: string | null;
  shippingCharge?: string | null;
  shippingChargeSource?: "NONE" | "RATE" | "MANUAL" | null;
  shippingRateAmount?: string | null;
  shippingOverrideReason?: string | null;
  serviceCharge?: string | null;
  /** What the customer pays; null on legacy orders (their payable total is Σ lines). */
  payableTotal?: string | null;
  agentDispatchedAt?: string | null;
  agentEarnedAt?: string | null;
  /** Spec 1B — PENDING when flagged for cross-scope duplicate review. */
  duplicateReviewStatus?: DuplicateReviewStatus;
  /** Spec 1A — optimistic concurrency version (amendments). */
  version?: number;
  /** Spec 2 — agent shipping tariff state and customer-total agreement. */
  shippingPricingStatus?: "NOT_APPLICABLE" | "PENDING_METHOD" | "CONFIRMED";
  customerTotalStatus?: "NONE" | "CONFIRMATION_REQUIRED" | "CONFIRMED";
  /** Agent orders — the terms snapshot (the typed customer lives in `.customer`). */
  agentTermsSnapshot?: {
    customer?: {
      name: string;
      mobile: string | null;
      countryId: string | null;
      city: string | null;
      address: string | null;
    } | null;
  } & Record<string, unknown>;
}

export interface StoreOrderListParams {
  search?: string;
  paymentStatus?: StoreOrderPaymentStatusValue | StoreOrderPaymentStatusValue[];
  declaredPaymentStatus?:
    StoreOrderDeclaredPaymentStatusValue | StoreOrderDeclaredPaymentStatusValue[];
  shippingStage?: StoreOrderShippingStageValue | StoreOrderShippingStageValue[];
  source?: StoreOrderSourceValue | StoreOrderSourceValue[];
  dateFrom?: string;
  dateTo?: string;
  page?: number;
  pageSize?: number;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
  /** `listIds` only — caps "select all"/"select first N" to the first N matching rows by `sortBy`/`sortOrder`. */
  limit?: number;
  /** ADR-0018 (M2 gap closure) — opts each row into a `profitability` summary. Ignored server-side unless the caller also holds `orders.profitability.view`. */
  includeProfitability?: boolean;
  costState?: CostState[];
  lossMaking?: boolean;
  /** Agents milestone — orders of one owner agent. */
  agentId?: string;
  /** Spec 1B duplicate review queue (`store-orders.duplicate_review`). */
  duplicateReviewStatus?: DuplicateReviewStatus;
}

export interface StoreOrderListResult {
  items: StoreOrderRow[];
  total: number;
  page: number;
  pageSize: number;
  /** Only present when a `costState`/`lossMaking` filter was applied — true if the bounded candidate scan hit its cap, meaning `total` may undercount. */
  profitabilityFilterCapped?: boolean;
}

export interface StoreOrderIdsResult {
  ids: string[];
  total: number;
}

/**
 * Store Orders module client — a Store Order is explicitly NOT a Sales
 * Order or a CRM Lead (separate top-level nav, separate backend resource).
 * `externalOrderId` is the order's unique identity; the Customer link is
 * matched by phone only during import, never re-derived here.
 */
/** An order the caller cannot open: masked identity + coarse status only (R7). */
export interface OrderGlobalLookupRestricted {
  restricted: true;
  orderNumber: string;
  statusBucket: "IN_PROGRESS" | "COMPLETED" | "CANCELLED" | "RETURNED";
  partialName: string;
  maskedPhone: string | null;
  notAssignedToYou: true;
}

export interface OrderGlobalLookupFull {
  restricted: false;
  id: string;
  orderNumber: string;
  orderDate: string;
  customerName: string;
  customerPhone: string | null;
  products: string;
  paymentStatus: string;
  shippingStage: string;
  shippingStatus: string | null;
}

export type OrderGlobalLookupResult = OrderGlobalLookupFull | OrderGlobalLookupRestricted;

export const storeOrdersService = {
  /** ADR-0018 — the one canonical Order Economics read; never recomputed client-side. */
  getEconomics: (storeOrderId: string) =>
    apiClient.get<OrderEconomics>(`/store-orders/${storeOrderId}/economics`),
  list: (params: StoreOrderListParams = {}) =>
    apiClient.get<StoreOrderListResult>(
      `/store-orders${buildQueryString(params as Record<string, unknown>)}`,
    ),
  /**
   * Exact Order Number global lookup (`orders.lookup_global`) — a safe,
   * read-only summary regardless of the caller's own-scope. Returns `null`
   * when no Order matches; never throws for "not found".
   */
  globalLookupByOrderNumber: (orderNumber: string) =>
    apiClient.get<OrderGlobalLookupResult | null>(
      `/store-orders/global-lookup${buildQueryString({ orderNumber })}`,
    ),
  listIds: (params: StoreOrderListParams = {}) =>
    apiClient.get<StoreOrderIdsResult>(
      `/store-orders/ids${buildQueryString(params as Record<string, unknown>)}`,
    ),
  get: (id: string) => apiClient.get<StoreOrderRow>(`/store-orders/${id}`),
  update: (id: string, dto: { notes?: string; employeeId?: string; sourceChannel?: string }) =>
    apiClient.patch<StoreOrderRow>(`/store-orders/${id}`, dto),
  archive: (id: string) => apiClient.post<StoreOrderRow>(`/store-orders/${id}/archive`),
  /** Pricing correction — only before any invoice or verified payment (server-enforced). */
  setLineAmounts: (id: string, items: { itemId: string; agreedAmount: number }[]) =>
    apiClient.post<StoreOrderRow>(`/store-orders/${id}/line-amounts`, { items }),
  create: (dto: {
    externalOrderId?: string;
    partner: {
      name: string;
      phone?: string;
      email?: string;
      countryId?: string;
      city?: string;
      address?: string;
    };
    orderDate?: string;
    source?: StoreOrderSourceValue;
    sourceChannel?: string;
    employeeId?: string;
    currencyId: string;
    paymentType?: StoreOrderPaymentTypeValue;
    notes?: string;
    fulfillmentMethod?: StoreOrderFulfillmentMethodValue;
    items: { productId: string; quantity: number; unitPrice: number }[];
    /** Optional Sales declaration recorded atomically with the order — never an accounting voucher. */
    declaration?: PaymentDeclarationInput & { idempotencyKey: string };
    /** Spec 1B — one key per create-form instance (a retry returns the first order). */
    creationIdempotencyKey?: string;
    /** Spec 1B — the answer to the duplicate customer warning. */
    duplicateResolution?: DuplicateResolution;
  }) => apiClient.post<StoreOrderRow & { idempotentReplay?: true }>("/store-orders", dto),
  addNote: (id: string, note: string) =>
    apiClient.post<StoreOrderRow>(`/store-orders/${id}/notes`, { text: note }),
  /**
   * Sales/Finance payment declaration (Unpaid / Paid in full / Partially
   * paid). `idempotencyKey` is generated once per dialog open, so a retry
   * or double click returns the same claim instead of a second one.
   */
  declarePayment: (id: string, dto: PaymentDeclarationInput, idempotencyKey: string) =>
    apiClient.post<PaymentDeclarationResult>(`/store-orders/${id}/payment-declaration`, {
      ...dto,
      idempotencyKey,
    }),
  /** Pickup workflow step — never automatic; COLLECTED is payment-gated server-side. */
  transitionPickup: (id: string, code: PickupTransitionCode) =>
    apiClient.post<StoreOrderRow>(`/store-orders/${id}/pickup/${code}`),
  canFulfill: (id: string) =>
    apiClient.get<FulfillmentGateResult>(`/store-orders/${id}/can-fulfill`),
  /** ADR-0018 (M2.2) — records the ACTUAL provider transaction fee for a Payment, superseding any PaymentSource fee estimate for it. */
  setPaymentActualFee: (paymentId: string, actualFeeAmount: number) =>
    apiClient.post<StoreOrderPaymentRow>(`/payments/${paymentId}/fee`, { actualFeeAmount }),
  paymentContext: (id: string) =>
    apiClient.get<{
      total: string;
      paid: string;
      outstanding: string;
      claimed?: string;
      remainingToClaim?: string;
      fullySettled?: boolean;
      canAcceptPayment?: boolean;
      currencyId: string;
      paymentStatus: string;
    }>(`/store-orders/${id}/payment-context`),
  generateInvoice: (id: string) =>
    apiClient.post<{ id: string; invoiceNumber: string }>(`/store-orders/${id}/generate-invoice`),
  activities: (id: string) =>
    apiClient.get<StoreOrderActivityEntry[]>(`/store-orders/${id}/activities`),
  /** Round 5 Spec 1A — guided amendments (`store-orders.amend`). */
  amendments: orderAmendmentsClient<StoreOrderRow>("/store-orders"),

  // Shipments — always scoped to a single Store Order; NEEDS_RESHIPMENT
  // always creates a brand-new Shipment row on the same order, never a new
  // Store Order.
  shipments: {
    /** No real file-upload pipeline exists anywhere in this app — the label is a pasted URL, same "attach by URL" convention as receipts. */
    setLabel: (storeOrderId: string, dto: { fileUrl: string; fileName?: string }) =>
      apiClient.post<StoreOrderShipmentRow>(`/store-orders/${storeOrderId}/shipments/label`, dto),
    setTrackingNumber: (storeOrderId: string, shipmentId: string, trackingNumber: string) =>
      apiClient.post<StoreOrderShipmentRow>(
        `/store-orders/${storeOrderId}/shipments/tracking-number`,
        { shipmentId, trackingNumber },
      ),
    setShippingCompany: (storeOrderId: string, shipmentId: string, shippingCompanyId: string) =>
      apiClient.post<StoreOrderShipmentRow>(
        `/store-orders/${storeOrderId}/shipments/shipping-company`,
        { shipmentId, shippingCompanyId },
      ),
    ship: (storeOrderId: string, shipmentId: string) =>
      apiClient.post<StoreOrderShipmentRow>(`/store-orders/${storeOrderId}/shipments/ship`, {
        shipmentId,
      }),
    outForDelivery: (storeOrderId: string, shipmentId: string) =>
      apiClient.post<StoreOrderShipmentRow>(
        `/store-orders/${storeOrderId}/shipments/out-for-delivery`,
        { shipmentId },
      ),
    deliver: (storeOrderId: string, shipmentId: string) =>
      apiClient.post<StoreOrderShipmentRow>(`/store-orders/${storeOrderId}/shipments/deliver`, {
        shipmentId,
      }),
    deliveryFailed: (storeOrderId: string, shipmentId: string, reason?: string) =>
      apiClient.post<StoreOrderShipmentRow>(
        `/store-orders/${storeOrderId}/shipments/delivery-failed`,
        { shipmentId, reason },
      ),
    reship: (storeOrderId: string) =>
      apiClient.post<StoreOrderShipmentRow>(`/store-orders/${storeOrderId}/shipments/reship`),
    /** Direct "change to any status" operation — no forced sequence, no rigid transition matrix. Also the way a FINAL shipment is manually reopened back to UNDER_SYNC. */
    setShippingStatus: (storeOrderId: string, shippingStatusId: string) =>
      apiClient.post<StoreOrderShipmentRow>(
        `/store-orders/${storeOrderId}/shipments/shipping-status`,
        { shippingStatusId },
      ),
    setShippingCost: (storeOrderId: string, shipmentId: string, shippingCost: number) =>
      apiClient.post<StoreOrderShipmentRow>(
        `/store-orders/${storeOrderId}/shipments/shipping-cost`,
        { shipmentId, baseShippingCost: shippingCost, costPaidBy: "CUSTOMER" },
      ),
    addNote: (storeOrderId: string, shipmentId: string, note: string) =>
      apiClient.post<StoreOrderShipmentRow>(`/store-orders/${storeOrderId}/shipments/notes`, {
        shipmentId,
        notes: note,
      }),

    // Shipping operational evidence on the CURRENT shipment attempt — reuses
    // the generic Attachment staging/download pipeline; never a Payment
    // Receipt (see `receipts` below / `attachmentsService`).
    attachments: {
      list: (storeOrderId: string) =>
        apiClient.get<ShipmentAttachmentRow[]>(
          `/store-orders/${storeOrderId}/shipments/attachments`,
        ),
      upload: (storeOrderId: string, file: File) => {
        const form = new FormData();
        form.append("file", file);
        return apiClient.postForm<ShipmentAttachmentRow>(
          `/store-orders/${storeOrderId}/shipments/attachments/upload`,
          form,
        );
      },
      remove: (storeOrderId: string, attachmentId: string) =>
        apiClient.delete<{ id: string }>(
          `/store-orders/${storeOrderId}/shipments/attachments/${attachmentId}`,
        ),
    },
  },

  // Receipts — the same "attach by URL" pattern used elsewhere in OMS
  // (e.g. Product's `imageUrl`) rather than a real file upload widget.
  receipts: {
    attach: (
      storeOrderId: string,
      dto: { fileUrl: string; fileName: string; paymentId?: string },
    ) => apiClient.post<StoreOrderReceiptRow>(`/store-orders/${storeOrderId}/receipts`, dto),
    upload: (storeOrderId: string, file: File) => {
      const form = new FormData();
      form.append("file", file);
      return apiClient.postForm<StoreOrderReceiptRow>(
        `/store-orders/${storeOrderId}/receipts/upload`,
        form,
      );
    },
    download: (storeOrderId: string, receiptId: string) =>
      apiClient.getBlob(`/store-orders/${storeOrderId}/receipts/${receiptId}/file`),
    archive: (storeOrderId: string, receiptId: string) =>
      apiClient.post<{ id: string }>(`/store-orders/${storeOrderId}/receipts/${receiptId}/archive`),
  },
};
