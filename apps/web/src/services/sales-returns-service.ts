import { apiClient } from "./api-client";
import type { CustomerRow } from "./customers-service";
import type { ProductRow } from "./products-service";
import type { WarehouseRow, UnitRow, TaxRow } from "@/config/master-data/entities";
import type { SalesDocumentStatusValue } from "./sales-quotations-service";
import type { CurrencyRow } from "@/config/master-data/entities";

export type { SalesDocumentStatusValue };

export interface SalesReturnActivityEntry {
  id: string;
  type: string;
  description: string;
  metadata: unknown;
  createdAt: string;
  createdBy: string | null;
}

export interface SalesReturnItemRow {
  id: string;
  salesReturnId: string;
  salesInvoiceItemId: string | null;
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
  notes: string | null;
}

export interface SalesReturnRow {
  id: string;
  returnNumber: string;
  customerId: string;
  customer?: CustomerRow;
  salesInvoiceId: string | null;
  salesInvoice?: { invoiceNumber: string } | null;
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
  postedToAccounting: boolean;
  accountingPostedAt: string | null;
  confirmedAt: string | null;
  confirmedBy: string | null;
  cancelledAt: string | null;
  cancelledBy: string | null;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
  updatedBy: string | null;
  deletedAt: string | null;
  items: SalesReturnItemRow[];
}

export interface SalesReturnLineItemPayload {
  productId: string;
  description?: string;
  warehouseId?: string;
  unitId: string;
  quantity: number;
  unitPrice: number;
  discountPercent?: number;
  discountValue?: number;
  taxId?: string;
  /** Links this return line back to the invoice line it reverses — the backend caps returned quantity at invoiced-minus-already-returned using this. */
  salesInvoiceItemId?: string;
  notes?: string;
}

export interface SalesReturnFormPayload {
  customerId: string;
  /** Required — TASK-048: a Sales Return must always originate from an existing Sales Invoice. */
  salesInvoiceId: string;
  currencyId?: string;
  referenceNumber?: string;
  internalNotes?: string;
  customerNotes?: string;
  items: SalesReturnLineItemPayload[];
}

export interface SalesReturnableSummaryItem {
  salesInvoiceItemId: string;
  invoicedQuantity: number;
  returnedQuantity: number;
  remainingQuantity: number;
}

export interface SalesReturnableSummary {
  items: SalesReturnableSummaryItem[];
}

export interface SalesReturnListParams {
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

export interface SalesReturnListResult {
  items: SalesReturnRow[];
  total: number;
  page: number;
  pageSize: number;
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
 * Sales Return module — fourth and final implementation of the
 * SalesDocumentEditor. `confirm` increases inventory
 * (`InventoryService.postSalesReturn`) server-side. TASK-048: every Return
 * must originate from a Sales Invoice — `create` always carries
 * `salesInvoiceId` plus each line's `salesInvoiceItemId`, and
 * `returnableSummary` reads the already-returned/remaining quantity per
 * invoice line so the "Create Return" flow can display and cap correctly
 * before ever submitting.
 */
export const salesReturnsService = {
  list: (params: SalesReturnListParams = {}) =>
    apiClient.get<SalesReturnListResult>(
      `/sales/returns${buildQueryString(params as Record<string, unknown>)}`,
    ),
  get: (id: string) => apiClient.get<SalesReturnRow>(`/sales/returns/${id}`),
  returnableSummary: (salesInvoiceId: string) =>
    apiClient.get<SalesReturnableSummary>(`/sales/returns/returnable-summary/${salesInvoiceId}`),
  create: (dto: SalesReturnFormPayload) => apiClient.post<SalesReturnRow>("/sales/returns", dto),
  update: (id: string, dto: Partial<SalesReturnFormPayload>) =>
    apiClient.patch<SalesReturnRow>(`/sales/returns/${id}`, dto),
  submit: (id: string) => apiClient.post<SalesReturnRow>(`/sales/returns/${id}/submit`),
  approve: (id: string) => apiClient.post<SalesReturnRow>(`/sales/returns/${id}/approve`),
  confirm: (id: string) => apiClient.post<SalesReturnRow>(`/sales/returns/${id}/confirm`),
  cancel: (id: string) => apiClient.post<SalesReturnRow>(`/sales/returns/${id}/cancel`),
  /** Soft-delete — hides the return from the list without destroying data. Only allowed from Draft/Cancelled/Confirmed/Closed (enforced server-side). */
  archive: (id: string) => apiClient.post<SalesReturnRow>(`/sales/returns/${id}/archive`),
  activities: (id: string) =>
    apiClient.get<SalesReturnActivityEntry[]>(`/sales/returns/${id}/activities`),
};
