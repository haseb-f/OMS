import { apiClient } from "./api-client";
import { buildQueryString } from "@/lib/query-string";
import type { PartnerRow } from "./partners-service";
import type { ProductRow } from "./products-service";
import type { UnitRow, TaxRow } from "@/config/master-data/entities";
import type { PurchaseTypeValue, PurchaseDocumentStatusValue } from "./purchase-quotations-service";
import type { CurrencyRow } from "@/config/master-data/entities";

export interface PurchaseOrderActivityEntry {
  id: string;
  type: string;
  description: string;
  metadata: unknown;
  createdAt: string;
  createdBy: string | null;
}

/** PurchaseOrder kept its own simpler Phase-1 status set (ADR-0015) — no PENDING_APPROVAL/CONFIRMED. */
export type PurchaseOrderStatusValue = "DRAFT" | "APPROVED" | "CANCELLED" | "CLOSED";

export interface PurchaseOrderItemRow {
  id: string;
  purchaseOrderId: string;
  productId: string;
  product?: ProductRow;
  description: string | null;
  quantity: number;
  unitId: string | null;
  unit?: UnitRow | null;
  unitPrice: string;
  discountValue: string;
  discountPercent: string;
  subtotal: string;
  /** Optional — a line may carry no tax at all; totals then compute with zero tax. */
  taxId: string | null;
  tax?: TaxRow | null;
  taxAmount: string;
  lineTotal: string;
  notes: string | null;
}

export interface PurchaseOrderRow {
  id: string;
  poNumber: string;
  partnerId: string;
  partner?: PartnerRow;
  quotationId: string | null;
  quotation?: { quotationNumber: string } | null;
  projectId: string | null;
  costCenterId: string | null;
  currencyId: string | null;
  currency?: CurrencyRow | null;
  purchaseType: PurchaseTypeValue;
  expectedDeliveryDate: string | null;
  referenceNumber: string | null;
  internalNotes: string | null;
  supplierNotes: string | null;
  status: PurchaseOrderStatusValue;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
  updatedBy: string | null;
  deletedAt: string | null;
  items: PurchaseOrderItemRow[];
  /** TASK-050 — Related Documents: only present on the single-record `get()` response. */
  invoices?: { id: string; invoiceNumber: string; status: PurchaseDocumentStatusValue }[];
}

export interface PurchaseOrderLineItemPayload {
  productId: string;
  description?: string;
  quantity: number;
  unitId?: string;
  unitPrice: number;
  discountValue?: number;
  discountPercent?: number;
  subtotal: number;
  taxId?: string;
  notes?: string;
}

export interface PurchaseOrderFormPayload {
  partnerId: string;
  currencyId?: string;
  purchaseType: PurchaseTypeValue;
  referenceNumber?: string;
  internalNotes?: string;
  supplierNotes?: string;
  items: PurchaseOrderLineItemPayload[];
}

export interface PurchaseOrderListParams {
  search?: string;
  status?: PurchaseOrderStatusValue | PurchaseOrderStatusValue[];
  partnerId?: string | string[];
  purchaseType?: PurchaseTypeValue;
  dateFrom?: string;
  dateTo?: string;
  page?: number;
  pageSize?: number;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
}

export interface PurchaseOrderListResult {
  items: PurchaseOrderRow[];
  total: number;
  page: number;
  pageSize: number;
}

/**
 * Purchase Order module (TASK-048, list parity + archive added TASK-042) —
 * `list` is now paginated (`{items,total,page,pageSize}`), matching every
 * other Purchasing list endpoint (Quotation/Invoice/Return).
 */
export const purchaseOrdersService = {
  list: (params: PurchaseOrderListParams = {}) =>
    apiClient.get<PurchaseOrderListResult>(
      `/purchase-orders${buildQueryString(params as Record<string, unknown>)}`,
    ),
  get: (id: string) => apiClient.get<PurchaseOrderRow>(`/purchase-orders/${id}`),
  create: (dto: PurchaseOrderFormPayload) =>
    apiClient.post<PurchaseOrderRow>("/purchase-orders", dto),
  /** Draft only (enforced server-side) — replaces all items when `items` is sent. */
  update: (id: string, dto: Partial<PurchaseOrderFormPayload>) =>
    apiClient.patch<PurchaseOrderRow>(`/purchase-orders/${id}`, dto),
  approve: (id: string) => apiClient.post<PurchaseOrderRow>(`/purchase-orders/${id}/approve`),
  cancel: (id: string) => apiClient.post<PurchaseOrderRow>(`/purchase-orders/${id}/cancel`),
  close: (id: string) => apiClient.post<PurchaseOrderRow>(`/purchase-orders/${id}/close`),
  /** Soft-delete — hides the PO from the list without destroying data. Only allowed from Draft/Cancelled/Closed (enforced server-side). */
  archive: (id: string) => apiClient.post<PurchaseOrderRow>(`/purchase-orders/${id}/archive`),
  activities: (id: string) =>
    apiClient.get<PurchaseOrderActivityEntry[]>(`/purchase-orders/${id}/activities`),
  /** Delegates to `PurchaseInvoicesService.createFromOrder` — every line converts as-is (Goods Receipt), one destination warehouse for the whole receipt. */
  convertToInvoice: (id: string, warehouseId: string) =>
    apiClient.post<{ id: string; invoiceNumber: string }>(
      `/purchase-orders/${id}/convert-to-invoice`,
      { warehouseId },
    ),
};
