import { apiClient } from "./api-client";
import { buildQueryString } from "@/lib/query-string";
import type { PartnerRow } from "./partners-service";
import type { ProductRow } from "./products-service";
import type { WarehouseRow, UnitRow, TaxRow } from "@/config/master-data/entities";
import type { CurrencyRow } from "@/config/master-data/entities";

/** Quotation uses its own dedicated `SalesQuotationActivity` table (TASK-037), not the shared polymorphic `MasterDataActivityLog` — same core fields, no `entityType`/`entityId`. */
export interface SalesQuotationActivityEntry {
  id: string;
  type: string;
  description: string;
  metadata: unknown;
  createdAt: string;
  createdBy: string | null;
}

export type SalesDocumentStatusValue =
  | "DRAFT"
  | "PENDING_APPROVAL"
  | "APPROVED"
  | "CONFIRMED"
  | "PARTIALLY_DELIVERED"
  | "DELIVERED"
  | "CANCELLED"
  | "CLOSED";

export interface SalesQuotationItemRow {
  id: string;
  salesQuotationId: string;
  productId: string;
  product?: ProductRow;
  description: string | null;
  warehouseId: string | null;
  warehouse?: WarehouseRow | null;
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

export interface SalesQuotationRow {
  id: string;
  quotationNumber: string;
  partnerId: string;
  partner?: PartnerRow;
  currencyId: string | null;
  currency?: CurrencyRow | null;
  documentDate: string;
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
  items: SalesQuotationItemRow[];
}

export interface SalesQuotationLineItemPayload {
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

export interface SalesQuotationFormPayload {
  partnerId: string;
  currencyId?: string;
  /** ISO date string — defaults to "now" server-side when omitted. */
  documentDate?: string;
  referenceNumber?: string;
  internalNotes?: string;
  customerNotes?: string;
  items: SalesQuotationLineItemPayload[];
}

export interface SalesQuotationListParams {
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

export interface SalesQuotationListResult {
  items: SalesQuotationRow[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ConvertQuotationToOrderLinePayload {
  quotationItemId: string;
  warehouseId: string;
  quantity?: number;
}

export interface ConvertQuotationToOrderPayload {
  items: ConvertQuotationToOrderLinePayload[];
}

/**
 * Sales Quotation module (TASK-040) — the first real document type built on
 * the Sales Document Editor Foundation (TASK-039). Hand-written, not
 * `createMasterDataService`: Quotation's business operations are Submit/
 * Approve/Cancel, not Archive/Restore — a different shape than the generic
 * Master Data CRUD contract.
 */
export const salesQuotationsService = {
  list: (params: SalesQuotationListParams = {}) =>
    apiClient.get<SalesQuotationListResult>(
      `/sales/quotations${buildQueryString(params as Record<string, unknown>)}`,
    ),
  get: (id: string) => apiClient.get<SalesQuotationRow>(`/sales/quotations/${id}`),
  create: (dto: SalesQuotationFormPayload) =>
    apiClient.post<SalesQuotationRow>("/sales/quotations", dto),
  update: (id: string, dto: Partial<SalesQuotationFormPayload>) =>
    apiClient.patch<SalesQuotationRow>(`/sales/quotations/${id}`, dto),
  submit: (id: string) => apiClient.post<SalesQuotationRow>(`/sales/quotations/${id}/submit`),
  approve: (id: string) => apiClient.post<SalesQuotationRow>(`/sales/quotations/${id}/approve`),
  cancel: (id: string) => apiClient.post<SalesQuotationRow>(`/sales/quotations/${id}/cancel`),
  /** Soft-delete — hides the quotation from the list without destroying data. Only allowed from Draft/Cancelled/Closed (enforced server-side). */
  archive: (id: string) => apiClient.post<SalesQuotationRow>(`/sales/quotations/${id}/archive`),
  activities: (id: string) =>
    apiClient.get<SalesQuotationActivityEntry[]>(`/sales/quotations/${id}/activities`),
  /** Delegates to the existing `SalesOrdersService.createFromQuotation` backend flow — no line-item math happens on the frontend. */
  convertToOrder: (id: string, dto: ConvertQuotationToOrderPayload) =>
    apiClient.post<{ id: string; orderNumber: string }>(
      `/sales/quotations/${id}/convert-to-order`,
      dto,
    ),
};
