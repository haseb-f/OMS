import { apiClient } from "./api-client";
import type { CurrencyRow, CostComponentRow, TaxRow } from "@/config/master-data/entities";

export type LandedCostStatusValue = "DRAFT" | "APPROVED" | "POSTED" | "CANCELLED";
/** `BY_COST` is this document's "allocate by purchase value" method (ADR-0017) — `EQUAL`/`MANUAL` are schema-reserved but rejected by the API until a later milestone. */
export type LandedCostAllocationMethodValue = "BY_QUANTITY" | "BY_COST";

export interface LandedCostLineRow {
  id: string;
  costComponentId: string;
  costComponent?: CostComponentRow;
  description: string | null;
  netAmount: string;
  taxId: string | null;
  tax?: TaxRow | null;
  taxAmount: string;
}

export interface LandedCostAllocationRow {
  id: string;
  purchaseInvoiceItemId: string;
  allocatedQuantity: number;
  allocatedAmount: string;
  purchaseInvoiceItem?: {
    id: string;
    productId: string;
    quantity: number;
    unitPrice: string;
    product?: { id: string; name: string; sku: string };
  };
}

export interface LandedCostActivityEntry {
  id: string;
  type: string;
  description: string;
  createdAt: string;
  createdBy: string | null;
}

export interface LandedCostDocumentRow {
  id: string;
  documentNumber: string;
  purchaseInvoiceId: string;
  purchaseInvoice?: { id: string; invoiceNumber: string; status: string };
  providerId: string | null;
  provider?: { id: string; name: string } | null;
  currencyId: string;
  currency?: CurrencyRow | null;
  referenceNumber: string | null;
  documentDate: string;
  allocationMethod: LandedCostAllocationMethodValue;
  status: LandedCostStatusValue;
  netTotal: string;
  taxTotal: string;
  approvedAt: string | null;
  approvedBy: string | null;
  postedAt: string | null;
  postedBy: string | null;
  cancelledAt: string | null;
  cancelledBy: string | null;
  createdAt: string;
  createdBy: string | null;
  lines: LandedCostLineRow[];
  allocations: LandedCostAllocationRow[];
  activities?: LandedCostActivityEntry[];
}

export interface LandedCostLinePayload {
  costComponentId: string;
  description?: string;
  netAmount: number;
  taxId?: string;
}

export interface LandedCostDocumentPayload {
  purchaseInvoiceId: string;
  providerId?: string;
  currencyId: string;
  referenceNumber?: string;
  documentDate: string;
  allocationMethod: LandedCostAllocationMethodValue;
  lines: LandedCostLinePayload[];
}

export interface AllocationPreviewLine {
  purchaseInvoiceItemId: string;
  productId: string;
  productName: string;
  quantity: number;
  purchaseValue: number;
  allocatedAmount: number;
}

export interface AllocationPreview {
  method: LandedCostAllocationMethodValue;
  netTotal: number;
  lines: AllocationPreviewLine[];
  allocatedTotal: number;
  difference: number;
}

/** Landed Cost Documents (ADR-0017 / Cost Engine M1) — attaches capitalizable acquisition cost to a CONFIRMED Purchase Invoice. */
export const landedCostService = {
  list: () => apiClient.get<LandedCostDocumentRow[]>("/landed-cost-documents"),
  get: (id: string) => apiClient.get<LandedCostDocumentRow>(`/landed-cost-documents/${id}`),
  previewAllocation: (id: string) =>
    apiClient.get<AllocationPreview>(`/landed-cost-documents/${id}/allocation-preview`),
  create: (dto: LandedCostDocumentPayload) =>
    apiClient.post<LandedCostDocumentRow>("/landed-cost-documents", dto),
  update: (id: string, dto: Partial<LandedCostDocumentPayload>) =>
    apiClient.patch<LandedCostDocumentRow>(`/landed-cost-documents/${id}`, dto),
  approve: (id: string) =>
    apiClient.post<LandedCostDocumentRow>(`/landed-cost-documents/${id}/approve`),
  /** DRAFT/APPROVED → POSTED: capitalizes into inventory valuation and posts the Journal Entry. */
  post: (id: string) =>
    apiClient.post<LandedCostDocumentRow>(`/landed-cost-documents/${id}/confirm`),
  cancel: (id: string) =>
    apiClient.post<LandedCostDocumentRow>(`/landed-cost-documents/${id}/cancel`),
};
