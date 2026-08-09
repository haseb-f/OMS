import { apiClient } from "./api-client";
import type { CustomerRow } from "./customers-service";
import type { SupplierRow } from "./suppliers-service";

export type FinancialTransactionTypeValue = "CUSTOMER_RECEIPT" | "SUPPLIER_PAYMENT";
export type FinancialTransactionStatusValue = "DRAFT" | "CONFIRMED" | "CANCELLED";
/** TASK-060B Part 6 — independent from document Workflow Status (Draft/Confirmed/Cancelled); `CANCELLED` here means the invoice itself was cancelled, never set manually. */
export type InvoicePaymentStatusValue = "UNPAID" | "PARTIALLY_PAID" | "PAID" | "CANCELLED";

/** Uses its own dedicated `FinancialTransactionActivity` table (TASK-043), not the shared polymorphic Master Data log — same core fields, no `entityType`/`entityId`. */
export interface FinancialTransactionActivityEntry {
  id: string;
  type: string;
  description: string;
  metadata: unknown;
  createdAt: string;
  createdBy: string | null;
}

export interface FinancialTransactionAllocationRow {
  id: string;
  transactionId: string;
  salesInvoiceId: string | null;
  salesInvoice?: { id: string; invoiceNumber: string; grandTotal: string } | null;
  purchaseInvoiceId: string | null;
  purchaseInvoice?: { id: string; invoiceNumber: string; grandTotal: string } | null;
  allocatedAmount: string;
  allocationDate: string;
}

export interface FinancialTransactionRow {
  id: string;
  transactionNumber: string;
  type: FinancialTransactionTypeValue;
  customerId: string | null;
  customer?: CustomerRow | null;
  supplierId: string | null;
  supplier?: SupplierRow | null;
  currencyId: string | null;
  currency?: { id: string; code: string; name: string } | null;
  transactionDate: string;
  paymentSourceId: string | null;
  paymentSource?: { id: string; name: string } | null;
  receivingAccountId: string | null;
  receivingAccount?: { id: string; name: string } | null;
  amount: string;
  referenceNumber: string | null;
  notes: string | null;
  status: FinancialTransactionStatusValue;
  confirmedAt: string | null;
  confirmedBy: string | null;
  cancelledAt: string | null;
  cancelledBy: string | null;
  postedToAccounting: boolean;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
  updatedBy: string | null;
  deletedAt: string | null;
  allocations: FinancialTransactionAllocationRow[];
}

export interface AllocationInputPayload {
  invoiceId: string;
  allocatedAmount: number;
}

export interface FinancialTransactionFormPayload {
  customerId?: string;
  supplierId?: string;
  currencyId?: string;
  transactionDate?: string;
  paymentSourceId?: string;
  receivingAccountId?: string;
  amount: number;
  referenceNumber?: string;
  notes?: string;
  allocations?: AllocationInputPayload[];
}

export interface FinancialTransactionListParams {
  search?: string;
  status?: FinancialTransactionStatusValue;
  customerId?: string;
  supplierId?: string;
  dateFrom?: string;
  dateTo?: string;
  page?: number;
  pageSize?: number;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
}

export interface FinancialTransactionListResult {
  items: FinancialTransactionRow[];
  total: number;
  page: number;
  pageSize: number;
}

/** Never computed on the frontend (task spec: "Never duplicate remaining-balance logic") — always exactly what `GET .../open-invoices` returns. */
export interface OpenInvoiceRow {
  invoiceId: string;
  invoiceNumber: string;
  documentDate: string;
  grandTotal: number;
  allocatedTotal: number;
  remainingBalance: number;
  paymentStatus: InvoicePaymentStatusValue;
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
 * Financial Transactions & Matching Engine (TASK-043) — the one generic
 * client factory behind both `customerReceiptsService` and
 * `supplierPaymentsService` (mirrors `createMasterDataService`'s factory
 * pattern). Business operations are Create/Update/Confirm/Cancel/Archive/
 * Allocate/Unallocate, not the Master Data Archive/Restore shape.
 */
export function createFinancialTransactionService(
  basePath: string,
  partyParam: "customerId" | "supplierId",
) {
  return {
    list: (params: FinancialTransactionListParams = {}) =>
      apiClient.get<FinancialTransactionListResult>(
        `${basePath}${buildQueryString(params as Record<string, unknown>)}`,
      ),
    get: (id: string) => apiClient.get<FinancialTransactionRow>(`${basePath}/${id}`),
    create: (dto: FinancialTransactionFormPayload) =>
      apiClient.post<FinancialTransactionRow>(basePath, dto),
    update: (id: string, dto: Partial<FinancialTransactionFormPayload>) =>
      apiClient.patch<FinancialTransactionRow>(`${basePath}/${id}`, dto),
    confirm: (id: string) => apiClient.post<FinancialTransactionRow>(`${basePath}/${id}/confirm`),
    cancel: (id: string) => apiClient.post<FinancialTransactionRow>(`${basePath}/${id}/cancel`),
    /** Soft-delete — hides the transaction from the list without destroying data. Only allowed from Draft/Cancelled (enforced server-side). */
    archive: (id: string) => apiClient.post<FinancialTransactionRow>(`${basePath}/${id}/archive`),
    /** Hard delete — Draft only (enforced server-side). Once Confirmed, use Cancel/Archive instead. */
    remove: (id: string) => apiClient.delete<void>(`${basePath}/${id}`),
    /** Adds one allocation to a Confirmed transaction. */
    allocate: (id: string, dto: AllocationInputPayload) =>
      apiClient.post<FinancialTransactionRow>(`${basePath}/${id}/allocate`, dto),
    /** Removes one allocation from a Confirmed transaction. */
    unallocate: (id: string, allocationId: string) =>
      apiClient.post<FinancialTransactionRow>(
        `${basePath}/${id}/allocations/${allocationId}/unallocate`,
      ),
    activities: (id: string) =>
      apiClient.get<FinancialTransactionActivityEntry[]>(`${basePath}/${id}/activities`),
    /** Every CONFIRMED invoice for this party with a remaining balance — the Allocation Grid / "Pay All Remaining" source. */
    openInvoices: (partyId: string) =>
      apiClient.get<OpenInvoiceRow[]>(
        `${basePath}/open-invoices${buildQueryString({ [partyParam]: partyId })}`,
      ),
  };
}
