import { apiClient } from "./api-client";
import type { CustomerRow } from "./customers-service";
import type { ProductRow } from "./products-service";
import type { WarehouseRow, UnitRow, TaxRow } from "@/config/master-data/entities";
import type { SalesDocumentStatusValue } from "./sales-quotations-service";
import type { CurrencyRow } from "@/config/master-data/entities";

export type { SalesDocumentStatusValue };

/** Sales Order uses its own dedicated `SalesOrderDocumentActivity` table, same shape as Quotation's. */
export interface SalesOrderActivityEntry {
  id: string;
  type: string;
  description: string;
  metadata: unknown;
  createdAt: string;
  createdBy: string | null;
}

export interface SalesOrderItemRow {
  id: string;
  salesOrderId: string;
  productId: string;
  product?: ProductRow;
  description: string | null;
  warehouseId: string;
  warehouse?: WarehouseRow;
  unitId: string;
  unit?: UnitRow;
  quantity: number;
  unitPrice: string;
  discountPercent: string;
  discountValue: string;
  taxId: string | null;
  tax?: TaxRow | null;
  taxAmount: string;
  lineTotal: string;
  deliveredQuantity: number;
  notes: string | null;
}

export interface SalesOrderRow {
  id: string;
  orderNumber: string;
  customerId: string;
  customer?: CustomerRow;
  quotationId: string | null;
  quotation?: { quotationNumber: string } | null;
  currencyId: string | null;
  currency?: CurrencyRow | null;
  referenceNumber: string | null;
  internalNotes: string | null;
  customerNotes: string | null;
  status: SalesDocumentStatusValue;
  subtotal: string;
  discountTotal: string;
  taxTotal: string;
  grandTotal: string;
  confirmedAt: string | null;
  confirmedBy: string | null;
  cancelledAt: string | null;
  cancelledBy: string | null;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
  updatedBy: string | null;
  deletedAt: string | null;
  items: SalesOrderItemRow[];
  /** TASK-050 — Related Documents: only present on the single-record `get()` response. */
  invoices?: { id: string; invoiceNumber: string; status: SalesDocumentStatusValue }[];
}

export interface SalesOrderLineItemPayload {
  productId: string;
  description?: string;
  warehouseId?: string;
  unitId: string;
  quantity: number;
  unitPrice: number;
  discountPercent?: number;
  discountValue?: number;
  taxId?: string;
  notes?: string;
}

export interface SalesOrderFormPayload {
  customerId: string;
  currencyId?: string;
  referenceNumber?: string;
  internalNotes?: string;
  customerNotes?: string;
  items: SalesOrderLineItemPayload[];
}

export interface SalesOrderListParams {
  search?: string;
  status?: SalesDocumentStatusValue;
  customerId?: string;
  /** ISO date-only strings ("2026-01-01") — filters by `createdAt`, the same column the list's Date column shows. */
  dateFrom?: string;
  dateTo?: string;
  page?: number;
  pageSize?: number;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
}

export interface SalesOrderListResult {
  items: SalesOrderRow[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ConvertOrderToInvoiceLinePayload {
  salesOrderItemId: string;
  quantity: number;
}

export interface ConvertOrderToInvoicePayload {
  items: ConvertOrderToInvoiceLinePayload[];
}

function buildQueryString(params: Record<string, unknown>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    search.set(key, String(value));
  }
  const qs = search.toString();
  return qs ? `?${qs}` : "";
}

/**
 * Sales Order module — the second implementation of the SalesDocumentEditor,
 * following the exact pattern established by Quotation. Hand-written (not
 * `createMasterDataService`): business operations are Submit/Approve/
 * Confirm/Cancel, not Archive/Restore. `confirm` is the Order-specific step
 * that reserves inventory server-side (`InventoryService.reserve`) — never
 * computed or triggered client-side beyond the button click itself.
 */
export const salesOrdersService = {
  list: (params: SalesOrderListParams = {}) =>
    apiClient.get<SalesOrderListResult>(
      `/sales/orders${buildQueryString(params as Record<string, unknown>)}`,
    ),
  get: (id: string) => apiClient.get<SalesOrderRow>(`/sales/orders/${id}`),
  create: (dto: SalesOrderFormPayload) => apiClient.post<SalesOrderRow>("/sales/orders", dto),
  update: (id: string, dto: Partial<SalesOrderFormPayload>) =>
    apiClient.patch<SalesOrderRow>(`/sales/orders/${id}`, dto),
  submit: (id: string) => apiClient.post<SalesOrderRow>(`/sales/orders/${id}/submit`),
  approve: (id: string) => apiClient.post<SalesOrderRow>(`/sales/orders/${id}/approve`),
  confirm: (id: string) => apiClient.post<SalesOrderRow>(`/sales/orders/${id}/confirm`),
  cancel: (id: string) => apiClient.post<SalesOrderRow>(`/sales/orders/${id}/cancel`),
  /** Soft-delete — hides the order from the list without destroying data. Only allowed from Draft/Cancelled/Delivered/Closed (enforced server-side). */
  archive: (id: string) => apiClient.post<SalesOrderRow>(`/sales/orders/${id}/archive`),
  activities: (id: string) =>
    apiClient.get<SalesOrderActivityEntry[]>(`/sales/orders/${id}/activities`),
  /** Delegates to the existing `SalesOrdersService.convertToInvoice` → `SalesInvoicesService.createFromOrder` backend flow — no line-item or inventory math happens on the frontend. */
  convertToInvoice: (id: string, dto: ConvertOrderToInvoicePayload) =>
    apiClient.post<{ id: string; invoiceNumber: string }>(
      `/sales/orders/${id}/convert-to-invoice`,
      dto,
    ),
};
