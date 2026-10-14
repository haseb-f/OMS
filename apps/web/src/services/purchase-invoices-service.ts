import type { ChartOfAccountRow } from "@/config/master-data/entities";
import { apiClient } from "./api-client";
import type { InvoiceSettlement } from "./invoice-settlement-types";
import { buildQueryString } from "@/lib/query-string";
import type { PartnerRow } from "./partners-service";
import type { ProductRow } from "./products-service";
import type { WarehouseRow, UnitRow, TaxRow } from "@/config/master-data/entities";
import type {
  PurchaseDocumentStatusValue,
  PurchaseLineItemPayload,
} from "./purchase-quotations-service";
import type {
  FinancialTransactionStatusValue,
  InvoicePaymentStatusValue,
} from "./financial-transactions-service";
import type { CurrencyRow } from "@/config/master-data/entities";

export interface PurchaseInvoiceActivityEntry {
  id: string;
  type: string;
  description: string;
  metadata: unknown;
  createdAt: string;
  createdBy: string | null;
}

export interface PurchaseInvoiceItemRow {
  id: string;
  purchaseInvoiceId: string;
  purchaseOrderItemId: string | null;
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
  /** Fixed-asset / prepaid-expense recognition of this line (Purchase Invoice only). */
  treatment?: "STANDARD" | "FIXED_ASSET" | "PREPAID_EXPENSE";
  assetUsefulLifeMonths?: number | null;
  assetDepreciationMethod?: "STRAIGHT_LINE" | "DECLINING_BALANCE" | null;
  scheduleStartDate?: string | null;
  prepaidMonths?: number | null;
  prepaidExpenseAccount?: ChartOfAccountRow | null;
  /** The fixed asset / prepaid expense this line is linked to (R13 C1). */
  fixedAsset?: { id: string; code: string | null; name: string; status: string } | null;
  /** R13b — the existing asset a cost-addition line adds its cost to. */
  linkedFixedAsset?: { id: string; code: string | null; name: string; status: string } | null;
  prepaidExpense?: { id: string; prepaidNumber: string; name: string; status: string } | null;
}

export interface PurchaseInvoiceRow {
  id: string;
  invoiceNumber: string;
  partnerId: string;
  partner?: PartnerRow;
  purchaseOrderId: string | null;
  purchaseOrder?: { poNumber: string } | null;
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
  items: PurchaseInvoiceItemRow[];
  /** TASK-060B Part 6 — Payment Status, always server-computed from `FinancialTransactionAllocation`, never editable, never re-derived by the frontend. Present on both list and detail responses. */
  paymentStatus: InvoicePaymentStatusValue;
  /** Cash allocated by confirmed vouchers (R22: kept = `paidTotal`). */
  allocatedTotal: number;
  remainingBalance: number;
  /** R22 contract 1 — cash paid (= `allocatedTotal`). */
  paidTotal?: number;
  /** R22 contract 1 — posted credit notes applied to this invoice, never cash. */
  creditedTotal?: number;
  /** R22 contract 1 — the invoice's currency code. */
  currencyCode?: string | null;
  /** TASK-050 — Related Documents: only present on the single-record `get()` response. */
  returns?: { id: string; returnNumber: string; status: PurchaseDocumentStatusValue }[];
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

export interface PurchaseInvoiceFormPayload {
  partnerId: string;
  currencyId?: string;
  referenceNumber?: string;
  internalNotes?: string;
  supplierNotes?: string;
  items: PurchaseLineItemPayload[];
}

export interface PurchaseInvoiceListParams {
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

export interface PurchaseInvoiceListResult {
  items: PurchaseInvoiceRow[];
  total: number;
  page: number;
  pageSize: number;
}

/** Purchase Invoice module (TASK-048) — Goods Receipt. Mirrors `salesInvoicesService`'s shape (no such file exists standalone — pattern taken from `salesQuotationsService`). */
export const purchaseInvoicesService = {
  list: (params: PurchaseInvoiceListParams = {}) =>
    apiClient.get<PurchaseInvoiceListResult>(
      `/purchasing/invoices${buildQueryString(params as Record<string, unknown>)}`,
    ),
  get: (id: string) => apiClient.get<PurchaseInvoiceRow>(`/purchasing/invoices/${id}`),
  /** R22 contract 2 — settlement summary + history (vouchers and credit notes, permission-scoped). */
  settlement: (id: string) =>
    apiClient.get<InvoiceSettlement>(`/purchasing/invoices/${id}/settlement`),
  create: (dto: PurchaseInvoiceFormPayload) =>
    apiClient.post<PurchaseInvoiceRow>("/purchasing/invoices", dto),
  update: (id: string, dto: Partial<PurchaseInvoiceFormPayload>) =>
    apiClient.patch<PurchaseInvoiceRow>(`/purchasing/invoices/${id}`, dto),
  submit: (id: string) => apiClient.post<PurchaseInvoiceRow>(`/purchasing/invoices/${id}/submit`),
  approve: (id: string) => apiClient.post<PurchaseInvoiceRow>(`/purchasing/invoices/${id}/approve`),
  /** New Draft copy (business fields only). */
  duplicate: (id: string) =>
    apiClient.post<PurchaseInvoiceRow>(`/purchasing/invoices/${id}/duplicate`),
  returnToDraft: (id: string) =>
    apiClient.post<PurchaseInvoiceRow>(`/purchasing/invoices/${id}/return-to-draft`),
  cancel: (id: string) => apiClient.post<PurchaseInvoiceRow>(`/purchasing/invoices/${id}/cancel`),
  /** Confirm = Goods Receipt: increases inventory. */
  confirm: (id: string) => apiClient.post<PurchaseInvoiceRow>(`/purchasing/invoices/${id}/confirm`),
  archive: (id: string) => apiClient.post<PurchaseInvoiceRow>(`/purchasing/invoices/${id}/archive`),
  activities: (id: string) =>
    apiClient.get<PurchaseInvoiceActivityEntry[]>(`/purchasing/invoices/${id}/activities`),
};
