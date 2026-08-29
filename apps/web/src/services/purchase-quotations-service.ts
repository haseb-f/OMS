import { apiClient } from "./api-client";
import { buildQueryString } from "@/lib/query-string";
import type { PartnerRow } from "./partners-service";
import type { ProductRow } from "./products-service";
import type { UnitRow, TaxRow } from "@/config/master-data/entities";
import type { CurrencyRow } from "@/config/master-data/entities";

/** Quotation uses its own dedicated `PurchaseQuotationActivity` table (TASK-048), not the shared polymorphic Master Data log. */
export interface PurchaseQuotationActivityEntry {
  id: string;
  type: string;
  description: string;
  metadata: unknown;
  createdAt: string;
  createdBy: string | null;
}

export type PurchaseDocumentStatusValue =
  "DRAFT" | "PENDING_APPROVAL" | "APPROVED" | "CONFIRMED" | "CANCELLED" | "CLOSED";

export type PurchaseTypeValue =
  "INVENTORY" | "SAMPLE" | "OFFICE_SUPPLY" | "SERVICE" | "FIXED_ASSET";

export interface PurchaseQuotationItemRow {
  id: string;
  purchaseQuotationId: string;
  productId: string;
  product?: ProductRow;
  description: string | null;
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

export interface PurchaseQuotationRow {
  id: string;
  quotationNumber: string;
  partnerId: string;
  partner?: PartnerRow;
  currencyId: string | null;
  currency?: CurrencyRow | null;
  purchaseType: PurchaseTypeValue;
  documentDate: string;
  referenceNumber: string | null;
  internalNotes: string | null;
  supplierNotes: string | null;
  status: PurchaseDocumentStatusValue;
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
  items: PurchaseQuotationItemRow[];
}

export interface PurchaseLineItemPayload {
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

export interface PurchaseQuotationFormPayload {
  partnerId: string;
  currencyId?: string;
  purchaseType: PurchaseTypeValue;
  documentDate?: string;
  referenceNumber?: string;
  internalNotes?: string;
  supplierNotes?: string;
  items: PurchaseLineItemPayload[];
}

export interface PurchaseQuotationListParams {
  search?: string;
  status?: PurchaseDocumentStatusValue | PurchaseDocumentStatusValue[];
  partnerId?: string | string[];
  dateFrom?: string;
  dateTo?: string;
  page?: number;
  pageSize?: number;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
}

export interface PurchaseQuotationListResult {
  items: PurchaseQuotationRow[];
  total: number;
  page: number;
  pageSize: number;
}

/**
 * Purchase Quotation module (TASK-048) — mirrors `salesQuotationsService`.
 * Hand-written, not `createMasterDataService`: business operations are
 * Submit/Approve/Cancel/Convert, not Archive/Restore.
 */
export const purchaseQuotationsService = {
  list: (params: PurchaseQuotationListParams = {}) =>
    apiClient.get<PurchaseQuotationListResult>(
      `/purchasing/quotations${buildQueryString(params as Record<string, unknown>)}`,
    ),
  get: (id: string) => apiClient.get<PurchaseQuotationRow>(`/purchasing/quotations/${id}`),
  create: (dto: PurchaseQuotationFormPayload) =>
    apiClient.post<PurchaseQuotationRow>("/purchasing/quotations", dto),
  update: (id: string, dto: Partial<PurchaseQuotationFormPayload>) =>
    apiClient.patch<PurchaseQuotationRow>(`/purchasing/quotations/${id}`, dto),
  submit: (id: string) =>
    apiClient.post<PurchaseQuotationRow>(`/purchasing/quotations/${id}/submit`),
  approve: (id: string) =>
    apiClient.post<PurchaseQuotationRow>(`/purchasing/quotations/${id}/approve`),
  cancel: (id: string) =>
    apiClient.post<PurchaseQuotationRow>(`/purchasing/quotations/${id}/cancel`),
  archive: (id: string) =>
    apiClient.post<PurchaseQuotationRow>(`/purchasing/quotations/${id}/archive`),
  activities: (id: string) =>
    apiClient.get<PurchaseQuotationActivityEntry[]>(`/purchasing/quotations/${id}/activities`),
  /** Delegates to the existing `PurchaseOrdersService.createFromQuotation` backend flow — the whole quotation converts as-is, no body needed. */
  convertToOrder: (id: string) =>
    apiClient.post<{ id: string; poNumber: string }>(
      `/purchasing/quotations/${id}/convert-to-order`,
    ),
};
