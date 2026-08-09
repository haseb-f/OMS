import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import type { StatusTone } from "@/components/business/status-badge";
import type { SupplierRow } from "@/services/suppliers-service";
import type { CurrencyRow } from "@/config/master-data/entities";
import type { DocumentPrintPayload } from "@/types/print-engine";
import type { DocumentTotals } from "@/components/sales/document-totals-footer";
import type { ProductLineItemsGridLine } from "@/components/sales/product-line-items-grid";

/**
 * Purchasing Document Editor Foundation (TASK-048) — mirrors
 * `sales-document-editor.types.ts` field-for-field, Supplier instead of
 * Customer. Reuses `ProductLineItemsGridLine`/`DocumentTotals` from the
 * Sales components directly (party-agnostic, not duplicated).
 */
export interface PurchaseDocumentActivityEntry {
  id: string;
  type: string;
  description: string;
  createdAt: string;
}

export interface PurchaseDocumentStatusOption {
  value: string;
  label: string;
  tone: StatusTone;
}

export type PurchaseDocumentWorkflowActionKey =
  "submit" | "approve" | "reject" | "confirm" | "cancel" | "convert" | "recordPayment" | "print";

export interface PurchaseDocumentEditorActionContext<TDocument> {
  document: TDocument | null;
  lines: ProductLineItemsGridLine[];
  supplier: SupplierRow | null;
}

export interface PurchaseDocumentWorkflowAction<TDocument> {
  key: PurchaseDocumentWorkflowActionKey;
  label: string;
  icon?: LucideIcon;
  variant?: "default" | "outline" | "destructive" | "ghost";
  visibleForStatuses?: string[];
  onAction: (context: PurchaseDocumentEditorActionContext<TDocument>) => void | Promise<void>;
}

export interface PurchaseDocumentNumberingConfig {
  documentType: string;
  docCodePreview?: string;
}

export interface PurchaseDocumentPermissions {
  create: string;
  edit: string;
  approve: string;
  cancel: string;
  /** Only Invoice/Return have a Confirm step (Quotation/Order's lifecycle ends earlier). */
  confirm?: string;
}

export type PurchaseDocumentPrintPayloadBuilder<TDocument> = (
  document: TDocument,
) => DocumentPrintPayload;

export interface PurchaseDocumentEditorConfig<TDocument> {
  title: string;
  documentType: string;
  permissions: PurchaseDocumentPermissions;
  statusOptions: PurchaseDocumentStatusOption[];
  workflowActions: PurchaseDocumentWorkflowAction<TDocument>[];
  numbering: PurchaseDocumentNumberingConfig;
  /** Invoice/Return require a Warehouse per line; Quotation/Order don't (PurchaseOrderItem has no warehouse column, ADR-0015). */
  requireWarehouse?: boolean;
  toolbarExtra?: ReactNode;
  buildPrintPayload?: PurchaseDocumentPrintPayloadBuilder<TDocument>;
}

export interface PurchaseDocumentEditorState<TDocument> {
  document: TDocument | null;
  documentNumber: string | null;
  status: string;
  documentDate: Date | null;
  supplier: SupplierRow | null;
  /** TASK-057A — document currency (`/currencies` master data). `null` = company base currency. */
  currency: CurrencyRow | null;
  referenceNumber: string;
  notes: string;
  terms: string;
  lines: ProductLineItemsGridLine[];
  totals: DocumentTotals | null;
}

export interface PurchaseDocumentEditorHandlers {
  onDocumentDateChange: (date: Date | null) => void;
  onSupplierChange: (supplier: SupplierRow) => void;
  onCurrencyChange: (currency: CurrencyRow | null) => void;
  onReferenceNumberChange: (value: string) => void;
  onNotesChange: (value: string) => void;
  onTermsChange: (value: string) => void;
  onLinesChange: (lines: ProductLineItemsGridLine[]) => void;
}
