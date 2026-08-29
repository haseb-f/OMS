import { apiClient } from "./api-client";
import { buildQueryString } from "@/lib/query-string";
import type { PartnerRow } from "./partners-service";
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
  partnerId: string;
  partner?: PartnerRow;
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
  partnerId: string;
  currencyId?: string;
  referenceNumber?: string;
  internalNotes?: string;
  customerNotes?: string;
  items: SalesOrderLineItemPayload[];
}

export interface SalesOrderListParams {
  search?: string;
  status?: SalesDocumentStatusValue | SalesDocumentStatusValue[];
  partnerId?: string | string[];
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

export interface SalesOrderIdsResult {
  ids: string[];
  total: number;
}

export interface BulkArchiveResult {
  succeeded: string[];
  failed: { id: string; message: string }[];
}

export interface ConvertOrderToInvoiceLinePayload {
  salesOrderItemId: string;
  quantity: number;
}

export interface ConvertOrderToInvoicePayload {
  items: ConvertOrderToInvoiceLinePayload[];
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
  /** "Select all matching filters" (Part 8) — same params as `list`, bare IDs only. */
  listIds: (params: SalesOrderListParams = {}) =>
    apiClient.get<SalesOrderIdsResult>(
      `/sales/orders/ids${buildQueryString(params as Record<string, unknown>)}`,
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
  /** One controlled server-side call instead of fanning out N concurrent archive requests for a large/cross-page selection. */
  bulkArchive: (ids: string[]) =>
    apiClient.post<BulkArchiveResult>(`/sales/orders/bulk-archive`, { ids }),
  activities: (id: string) =>
    apiClient.get<SalesOrderActivityEntry[]>(`/sales/orders/${id}/activities`),
  /** Delegates to the existing `SalesOrdersService.convertToInvoice` → `SalesInvoicesService.createFromOrder` backend flow — no line-item or inventory math happens on the frontend. */
  convertToInvoice: (id: string, dto: ConvertOrderToInvoicePayload) =>
    apiClient.post<{ id: string; invoiceNumber: string }>(
      `/sales/orders/${id}/convert-to-invoice`,
      dto,
    ),
};
