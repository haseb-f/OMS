import { apiClient } from "@/services/api-client";

/**
 * R15 W5a — client of the store-order stock lifecycle endpoints
 * (`apps/api/src/store-orders/stock-lifecycle/store-order-stock.controller.ts`
 * and the shipment dispatch / delivery bodies). Types mirror the API read
 * model (`StoreOrderStockService.view`).
 */
export type StoreOrderStockStatus =
  | "PENDING"
  | "NOT_REQUIRED"
  | "RESERVED"
  | "SHORT"
  | "IN_TRANSIT"
  | "PARTIALLY_DELIVERED"
  | "DELIVERED"
  | "RETURNING"
  | "RETURNED"
  | "RELEASED";

export const STORE_ORDER_STOCK_STATUSES: StoreOrderStockStatus[] = [
  "PENDING",
  "NOT_REQUIRED",
  "RESERVED",
  "SHORT",
  "IN_TRANSIT",
  "PARTIALLY_DELIVERED",
  "DELIVERED",
  "RETURNING",
  "RETURNED",
  "RELEASED",
];

export type WarehouseRole = "STOCK" | "TRANSIT" | "DAMAGED";

export interface StockWarehouseRef {
  id: string;
  code: string;
  name: string;
  role: WarehouseRole;
}

export interface StockShortLine {
  storeOrderItemId: string;
  productId: string;
  sku: string;
  kitSku?: string;
  warehouseId: string;
  warehouseCode: string | null;
  required: number;
  available: number;
}

export interface StockIssue {
  code: string;
  messageAr: string;
  messageEn: string;
  lines: StockShortLine[];
  at: string;
}

export interface StoreOrderStockLine {
  storeOrderItemId: string;
  productId: string;
  sku: string;
  name: string;
  /** False for services / digital lines (nothing to move). */
  stockLine: boolean;
  ordered: number;
  reserved: number;
  inTransit: number;
  delivered: number;
  returnedSaleable: number;
  returnedDamaged: number;
  short: number;
  warehouse: StockWarehouseRef | null;
  reservations: Array<{
    productId: string;
    sku: string;
    warehouse: StockWarehouseRef | null;
    quantity: number;
  }>;
}

export interface StoreOrderStockShipment {
  id: string;
  attemptNumber: number;
  isReship: boolean;
  status: string | null;
  lines: Array<{
    id: string;
    storeOrderItemId: string;
    quantity: number;
    carried: number;
    deliveredQuantity: number;
    returnedQuantity: number;
    /** Units of this attempt still with the carrier. */
    withCarrier: number;
  }>;
}

export interface StoreOrderStockMovement {
  id: string;
  movementNumber: string;
  type: string;
  productId: string;
  sku: string;
  warehouse: StockWarehouseRef | null;
  quantity: number;
  referenceType: string | null;
  referenceId: string | null;
  createdAt: string;
}

export interface StoreOrderStockView {
  orderId: string;
  internalOrderId: string;
  isAgentOrder: boolean;
  active: boolean;
  stockStatus: StoreOrderStockStatus;
  stockIssue: StockIssue | null;
  canReserve: boolean;
  /** Cost of goods sold as posted (journal of the order's invoices / returns); null for agent orders. */
  postedCogs: number | null;
  canReceiveBack: boolean;
  lines: StoreOrderStockLine[];
  shipments: StoreOrderStockShipment[];
  movements: StoreOrderStockMovement[];
}

export interface LineQuantity {
  storeOrderItemId: string;
  quantity: number;
}

export type ReceiveCondition = "SALEABLE" | "DAMAGED";

export interface ReceiveBackLine extends LineQuantity {
  condition: ReceiveCondition;
  warehouseId?: string;
}

export interface StockAvailabilityLine {
  productId: string;
  quantity: number;
  stockLine: boolean;
  warehouseId: string | null;
  warehouseCode: string | null;
  available: number | null;
  sufficient: boolean;
}

export const storeOrderStockApi = {
  view: (orderId: string) => apiClient.get<StoreOrderStockView>(`/store-orders/${orderId}/stock`),
  reserve: (orderId: string) =>
    apiClient.post<StoreOrderStockView>(`/store-orders/${orderId}/stock/reserve`),
  receiveBack: (orderId: string, body: { idempotencyKey: string; lines: ReceiveBackLine[] }) =>
    apiClient.post<StoreOrderStockView>(`/store-orders/${orderId}/stock/receive-back`, body),
  reserveShort: (limit?: number) =>
    apiClient.post<{
      processed: number;
      reserved: number;
      stillShort: number;
      failed: number;
      more: boolean;
    }>("/store-orders/stock/reserve-short", limit ? { limit } : {}),
  /** Order forms: what each line could reserve now (D15-2). */
  availability: (lines: Array<{ productId: string; quantity: number }>) =>
    apiClient.post<{ lines: StockAvailabilityLine[] }>("/store-orders/stock/availability", {
      lines,
    }),
  /** Dispatch with the quantities this parcel carries (omitted = everything reserved). */
  ship: (orderId: string, lines?: LineQuantity[]) =>
    apiClient.post(`/store-orders/${orderId}/shipments/ship`, lines ? { lines } : {}),
  /** Delivery with the accepted quantities (omitted = everything the parcel carried). */
  deliver: (orderId: string, deliveredLines?: LineQuantity[]) =>
    apiClient.post(
      `/store-orders/${orderId}/shipments/deliver`,
      deliveredLines ? { deliveredLines } : {},
    ),
  /** After a delivered attempt: a new shipment for the quantities still to go. */
  nextShipment: (orderId: string) => apiClient.post(`/store-orders/${orderId}/shipments/next`),
};
