import { apiClient } from "./api-client";
import { buildQueryString } from "@/lib/query-string";
import type { PartnerRow } from "./partners-service";
import type { ProductRow } from "./products-service";
import type { WarehouseRow, UnitRow, TaxRow } from "@/config/master-data/entities";
import type { PurchaseDocumentStatusValue } from "./purchase-quotations-service";
import type { CurrencyRow } from "@/config/master-data/entities";

export interface PurchaseReturnActivityEntry {
  id: string;
  type: string;
  description: string;
  metadata: unknown;
  createdAt: string;
  createdBy: string | null;
}

export interface PurchaseReturnItemRow {
  id: string;
  purchaseReturnId: string;
  purchaseInvoiceItemId: string | null;
  productId: string;
  product?: ProductRow;
  description: string | null;
  warehouseId: string;
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

export interface PurchaseReturnRow {
  id: string;
  returnNumber: string;
  partnerId: string;
  partner?: PartnerRow;
  purchaseInvoiceId: string | null;
  purchaseInvoice?: { invoiceNumber: string } | null;
  currencyId: string | null;
  currency?: CurrencyRow | null;
  referenceNumber: string | null;
  internalNotes: string | null;
  supplierNotes: string | null;
  status: PurchaseDocumentStatusValue;
  subtotal: string;
  discountTotal: string;
  taxTotal: string;
  grandTotal: string;
  postedToAccounting: boolean;
  confirmedAt: string | null;
  confirmedBy: string | null;
  cancelledAt: string | null;
  cancelledBy: string | null;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
  updatedBy: string | null;
  deletedAt: string | null;
  items: PurchaseReturnItemRow[];
}

export interface PurchaseReturnLineItemPayload {
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
  purchaseInvoiceItemId?: string;
}

export interface PurchaseReturnFormPayload {
  partnerId: string;
  /** Required — TASK-048: a Purchase Return must always originate from an existing Purchase Invoice. */
  purchaseInvoiceId: string;
  currencyId?: string;
  referenceNumber?: string;
  internalNotes?: string;
  supplierNotes?: string;
  items: PurchaseReturnLineItemPayload[];
}

export interface PurchaseReturnableSummaryItem {
  purchaseInvoiceItemId: string;
  invoicedQuantity: number;
  returnedQuantity: number;
  remainingQuantity: number;
}

export interface PurchaseReturnableSummary {
  items: PurchaseReturnableSummaryItem[];
}

export interface PurchaseReturnListParams {
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

export interface PurchaseReturnListResult {
  items: PurchaseReturnRow[];
  total: number;
  page: number;
  pageSize: number;
}

/** Purchase Return module (TASK-048) — mirrors `salesReturnsService`'s shape. */
export const purchaseReturnsService = {
  list: (params: PurchaseReturnListParams = {}) =>
    apiClient.get<PurchaseReturnListResult>(
      `/purchasing/returns${buildQueryString(params as Record<string, unknown>)}`,
    ),
  get: (id: string) => apiClient.get<PurchaseReturnRow>(`/purchasing/returns/${id}`),
  returnableSummary: (purchaseInvoiceId: string) =>
    apiClient.get<PurchaseReturnableSummary>(
      `/purchasing/returns/returnable-summary/${purchaseInvoiceId}`,
    ),
  create: (dto: PurchaseReturnFormPayload) =>
    apiClient.post<PurchaseReturnRow>("/purchasing/returns", dto),
  update: (id: string, dto: Partial<PurchaseReturnFormPayload>) =>
    apiClient.patch<PurchaseReturnRow>(`/purchasing/returns/${id}`, dto),
  submit: (id: string) => apiClient.post<PurchaseReturnRow>(`/purchasing/returns/${id}/submit`),
  approve: (id: string) => apiClient.post<PurchaseReturnRow>(`/purchasing/returns/${id}/approve`),
  cancel: (id: string) => apiClient.post<PurchaseReturnRow>(`/purchasing/returns/${id}/cancel`),
  /** Confirm = Decrease Inventory — goods going back to the Supplier. */
  confirm: (id: string) => apiClient.post<PurchaseReturnRow>(`/purchasing/returns/${id}/confirm`),
  archive: (id: string) => apiClient.post<PurchaseReturnRow>(`/purchasing/returns/${id}/archive`),
  activities: (id: string) =>
    apiClient.get<PurchaseReturnActivityEntry[]>(`/purchasing/returns/${id}/activities`),
};
