import { apiClient } from "./api-client";
import { buildQueryString } from "@/lib/query-string";

export type StoreOrderSourceValue = "MANUAL" | "IMPORT";

export type StoreOrderPaymentStatusValue =
  | "PAYMENT_PENDING"
  | "PARTIALLY_PAID"
  | "FULLY_PAID_RECONCILED"
  | "OVERPAID"
  | "UNMATCHED"
  | "PAYMENT_REVIEW";

export type StoreOrderShippingStageValue = "NOT_READY" | "READY_FOR_SHIPPING";

export interface StoreOrderCustomerRef {
  id: string;
  name: string;
  phone: string | null;
  mobile?: string | null;
  email?: string | null;
  address?: string | null;
  city?: string | null;
}

export interface StoreOrderItemRow {
  id: string;
  productId: string;
  product?: { id: string; name: string; sku: string } | null;
  quantity: number;
  unitPrice: string;
}

export interface StoreOrderPaymentRow {
  id: string;
  paymentNumber: string;
  amount: string;
  status: string;
  paymentDate: string;
}

export interface StoreOrderReceiptRow {
  id: string;
  fileUrl: string;
  fileName: string;
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
  labelCreatedAt: string | null;
  shippedAt: string | null;
  outForDeliveryAt: string | null;
  deliveredAt: string | null;
  deliveryFailedAt: string | null;
  shippingCost: string | null;
  notes: string | null;
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
  customerId: string;
  customer?: StoreOrderCustomerRef | null;
  orderDate: string;
  source: StoreOrderSourceValue;
  sourceChannel: string | null;
  employeeId: string | null;
  paymentStatus: StoreOrderPaymentStatusValue;
  shippingStage: StoreOrderShippingStageValue;
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
}

export interface StoreOrderListParams {
  search?: string;
  paymentStatus?: StoreOrderPaymentStatusValue | StoreOrderPaymentStatusValue[];
  shippingStage?: StoreOrderShippingStageValue | StoreOrderShippingStageValue[];
  source?: StoreOrderSourceValue | StoreOrderSourceValue[];
  dateFrom?: string;
  dateTo?: string;
  page?: number;
  pageSize?: number;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
}

export interface StoreOrderListResult {
  items: StoreOrderRow[];
  total: number;
  page: number;
  pageSize: number;
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
export const storeOrdersService = {
  list: (params: StoreOrderListParams = {}) =>
    apiClient.get<StoreOrderListResult>(
      `/store-orders${buildQueryString(params as Record<string, unknown>)}`,
    ),
  listIds: (params: StoreOrderListParams = {}) =>
    apiClient.get<StoreOrderIdsResult>(
      `/store-orders/ids${buildQueryString(params as Record<string, unknown>)}`,
    ),
  get: (id: string) => apiClient.get<StoreOrderRow>(`/store-orders/${id}`),
  create: (dto: {
    externalOrderId?: string;
    customer: {
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
    notes?: string;
    items: { productId: string; quantity: number; unitPrice: number }[];
    payment?: {
      paymentSourceId: string;
      receivingAccountId: string;
      paymentDate: string;
      amount: number;
      senderName: string;
      currencyId?: string;
      referenceNumber?: string;
      bankAccount?: string;
      receivedDate?: string;
    };
  }) => apiClient.post<StoreOrderRow>("/store-orders", dto),
  addNote: (id: string, note: string) =>
    apiClient.post<StoreOrderRow>(`/store-orders/${id}/notes`, { note }),
  /** Manual "Add Payment" (Part 4 of the four-gaps task) — a normal `Payment` row, same shape the optional first-payment-on-create path already uses; recomputes `paymentStatus`/`shippingStage` server-side exactly like every other payment write. */
  addPayment: (
    id: string,
    dto: {
      paymentDate: string;
      receivedDate?: string;
      amount: number;
      currencyId?: string;
      paymentSourceId: string;
      receivingAccountId: string;
      referenceNumber?: string;
      senderName: string;
      bankAccount?: string;
    },
  ) => apiClient.post<StoreOrderPaymentRow>(`/store-orders/${id}/payments`, dto),
  generateInvoice: (id: string) =>
    apiClient.post<{ id: string; invoiceNumber: string }>(`/store-orders/${id}/generate-invoice`),
  activities: (id: string) =>
    apiClient.get<StoreOrderActivityEntry[]>(`/store-orders/${id}/activities`),

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
    setShippingCost: (storeOrderId: string, shipmentId: string, shippingCost: number) =>
      apiClient.post<StoreOrderShipmentRow>(
        `/store-orders/${storeOrderId}/shipments/shipping-cost`,
        { shipmentId, shippingCost },
      ),
    addNote: (storeOrderId: string, shipmentId: string, note: string) =>
      apiClient.post<StoreOrderShipmentRow>(`/store-orders/${storeOrderId}/shipments/notes`, {
        shipmentId,
        note,
      }),
  },

  // Receipts — the same "attach by URL" pattern used elsewhere in OMS
  // (e.g. Product's `imageUrl`) rather than a real file upload widget.
  receipts: {
    attach: (
      storeOrderId: string,
      dto: { fileUrl: string; fileName: string; paymentId?: string },
    ) => apiClient.post<StoreOrderReceiptRow>(`/store-orders/${storeOrderId}/receipts`, dto),
  },
};
