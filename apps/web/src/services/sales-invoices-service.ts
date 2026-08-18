import { apiClient } from "./api-client";
import { buildQueryString } from "@/lib/query-string";
import type { CustomerRow } from "./customers-service";
import type { ProductRow } from "./products-service";
import type { WarehouseRow, UnitRow, TaxRow } from "@/config/master-data/entities";
import type { SalesDocumentStatusValue } from "./sales-quotations-service";
import type {
  FinancialTransactionStatusValue,
  InvoicePaymentStatusValue,
} from "./financial-transactions-service";
import type { CurrencyRow } from "@/config/master-data/entities";

export type { SalesDocumentStatusValue };

export interface SalesInvoiceActivityEntry {
  id: string;
  type: string;
  description: string;
  metadata: unknown;
  createdAt: string;
  createdBy: string | null;
}

export interface SalesInvoiceItemRow {
  id: string;
  salesInvoiceId: string;
  salesOrderItemId: string | null;
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

export interface SalesInvoiceRow {
  id: string;
  invoiceNumber: string;
  customerId: string;
  customer?: CustomerRow;
  salesOrderId: string | null;
  salesOrder?: { orderNumber: string } | null;
  currencyId: string | null;
  currency?: CurrencyRow | null;
  paymentTermId: string | null;
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
  items: SalesInvoiceItemRow[];
  /** TASK-060B Part 6 — Payment Status, always server-computed from `FinancialTransactionAllocation`, never editable, never re-derived by the frontend. Present on both list and detail responses. */
  paymentStatus: InvoicePaymentStatusValue;
  allocatedTotal: number;
  remainingBalance: number;
  /** TASK-050 — Related Documents: only present on the single-record `get()` response. */
  returns?: { id: string; returnNumber: string; status: SalesDocumentStatusValue }[];
  allocations?: {
    id: string;
    allocatedAmount: string;
    transaction: {
      id: string;
      transactionNumber: string;
      status: FinancialTransactionStatusValue;
    } | null;
  }[];
}

export interface SalesInvoiceLineItemPayload {
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

export interface SalesInvoiceFormPayload {
  customerId: string;
  currencyId?: string;
  referenceNumber?: string;
  internalNotes?: string;
  customerNotes?: string;
  items: SalesInvoiceLineItemPayload[];
}

export interface SalesInvoiceListParams {
  search?: string;
  status?: SalesDocumentStatusValue | SalesDocumentStatusValue[];
  customerId?: string | string[];
  /** ISO date-only strings ("2026-01-01") — filters by `createdAt`, the same column the list's Date column shows. */
  dateFrom?: string;
  dateTo?: string;
  page?: number;
  pageSize?: number;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
}

export interface SalesInvoiceListResult {
  items: SalesInvoiceRow[];
  total: number;
  page: number;
  pageSize: number;
}

/**
 * Sales Invoice module — third implementation of the SalesDocumentEditor.
 * `confirm` reduces inventory (`InventoryService.postSalesDelivery`) and, if
 * this invoice traces back to a Sales Order, releases that order's
 * reservation and rolls its delivered-quantity/status up — all server-side.
 * A Confirmed invoice is never cancelled directly (enforced by the backend);
 * the frontend simply stops offering Cancel once status leaves the
 * pre-Confirmed range (see order-editor-page's `visibleForStatuses`).
 */
export const salesInvoicesService = {
  list: (params: SalesInvoiceListParams = {}) =>
    apiClient.get<SalesInvoiceListResult>(
      `/sales/invoices${buildQueryString(params as Record<string, unknown>)}`,
    ),
  get: (id: string) => apiClient.get<SalesInvoiceRow>(`/sales/invoices/${id}`),
  create: (dto: SalesInvoiceFormPayload) => apiClient.post<SalesInvoiceRow>("/sales/invoices", dto),
  update: (id: string, dto: Partial<SalesInvoiceFormPayload>) =>
    apiClient.patch<SalesInvoiceRow>(`/sales/invoices/${id}`, dto),
  submit: (id: string) => apiClient.post<SalesInvoiceRow>(`/sales/invoices/${id}/submit`),
  approve: (id: string) => apiClient.post<SalesInvoiceRow>(`/sales/invoices/${id}/approve`),
  confirm: (id: string) => apiClient.post<SalesInvoiceRow>(`/sales/invoices/${id}/confirm`),
  cancel: (id: string) => apiClient.post<SalesInvoiceRow>(`/sales/invoices/${id}/cancel`),
  /** Soft-delete — hides the invoice from the list without destroying data. Only allowed from Draft/Cancelled/Confirmed/Closed (enforced server-side). */
  archive: (id: string) => apiClient.post<SalesInvoiceRow>(`/sales/invoices/${id}/archive`),
  activities: (id: string) =>
    apiClient.get<SalesInvoiceActivityEntry[]>(`/sales/invoices/${id}/activities`),
};
