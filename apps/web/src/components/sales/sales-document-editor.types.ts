import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import type { StatusTone } from "@/components/business/status-badge";
import type { PartnerRow } from "@/services/partners-service";
import type { CurrencyRow } from "@/config/master-data/entities";
import type { DocumentPrintPayload } from "@/types/print-engine";
import type { DocumentTotals } from "./document-totals-footer";
import type { ProductLineItemsGridLine } from "./product-line-items-grid";

/**
 * Minimal activity-timeline entry shape — deliberately not
 * `MasterDataActivityEntry` (which requires `entityType`/`entityId` for the
 * shared polymorphic activity log). Sales documents each have their own
 * dedicated `*Activity` table (TASK-037) with no such fields, so the editor
 * only depends on what it actually renders.
 */
export interface SalesDocumentActivityEntry {
  id: string;
  type: string;
  description: string;
  createdAt: string;
}

/**
 * Sales Document Editor Foundation (TASK-039) — the Configuration Engine.
 * A future Quotation/Order/Invoice/Return page supplies one
 * `SalesDocumentEditorConfig` + one `SalesDocumentEditorState` +
 * `SalesDocumentEditorHandlers` to `<SalesDocumentEditor>`; nothing
 * document-specific lives inside the shell itself.
 */

/** Mirrors the backend's shared `SalesDocumentStatus` enum — the shell never hardcodes which subset/labels/tones a given document type uses for it. */
export interface SalesDocumentStatusOption {
  value: string;
  label: string;
  tone: StatusTone;
}

export type SalesDocumentWorkflowActionKey =
  "submit" | "approve" | "reject" | "confirm" | "cancel" | "convert" | "receivePayment" | "print";

export interface SalesDocumentEditorActionContext<TDocument> {
  document: TDocument | null;
  lines: ProductLineItemsGridLine[];
  customer: PartnerRow | null;
}

/**
 * One workflow button. Prepared as a hook only per this task's scope — no
 * document type wires a real `onAction` yet; the shell renders whatever
 * actions a config supplies and calls them on click, nothing more.
 */
export interface SalesDocumentWorkflowAction<TDocument> {
  key: SalesDocumentWorkflowActionKey;
  label: string;
  icon?: LucideIcon;
  variant?: "default" | "outline" | "destructive" | "ghost";
  /** Only rendered when the document's current status is one of these — omit to always show. */
  visibleForStatuses?: string[];
  onAction: (context: SalesDocumentEditorActionContext<TDocument>) => void | Promise<void>;
}

export interface SalesDocumentNumberingConfig {
  /** NumberSeries `documentType` key — reference/display only. The shell never calls the Numbering Engine; the consuming document's own backend does, on save. */
  documentType: string;
  /** e.g. "QT" — shown as a preview prefix before the real number is assigned. */
  docCodePreview?: string;
}

export interface SalesDocumentPermissions {
  create: string;
  edit: string;
  approve: string;
  cancel: string;
  /** Only Order/Invoice/Return have a Confirm step (Quotation's lifecycle ends at Approved). */
  confirm?: string;
}

/**
 * Print Payload Builder Interface (its own deliverable per this task) — a
 * function shape every document type will eventually implement to turn its
 * own record into the existing Print Engine's `DocumentPrintPayload`. Only
 * the interface is defined here; no template/implementation.
 */
export type SalesDocumentPrintPayloadBuilder<TDocument> = (
  document: TDocument,
) => DocumentPrintPayload;

export interface SalesDocumentEditorConfig<TDocument> {
  title: string;
  documentType: string;
  permissions: SalesDocumentPermissions;
  statusOptions: SalesDocumentStatusOption[];
  workflowActions: SalesDocumentWorkflowAction<TDocument>[];
  numbering: SalesDocumentNumberingConfig;
  /** Order/Invoice/Return require a Warehouse per line; Quotation doesn't. */
  requireWarehouse?: boolean;
  /** Extra toolbar content specific to this document type (e.g. a future "Convert to Order" button that isn't a generic workflow action). */
  toolbarExtra?: ReactNode;
  /** See `SalesDocumentPrintPayloadBuilder` — wired to the Print action when supplied. */
  buildPrintPayload?: SalesDocumentPrintPayloadBuilder<TDocument>;
}

export interface SalesDocumentEditorState<TDocument> {
  document: TDocument | null;
  /** `null` = not yet assigned (new, unsaved document) — the header shows `config.numbering.docCodePreview` instead. */
  documentNumber: string | null;
  status: string;
  documentDate: Date | null;
  expectedDate?: Date | null;
  salespersonId: string | null;
  customer: PartnerRow | null;
  /** TASK-057A — document currency (`/currencies` master data). `null` = company base currency. */
  currency: CurrencyRow | null;
  referenceNumber: string;
  notes: string;
  terms: string;
  lines: ProductLineItemsGridLine[];
  /** Always backend-sourced — see `DocumentTotalsFooter`'s own contract. */
  totals: DocumentTotals | null;
}

export interface SalesDocumentEditorHandlers {
  onDocumentDateChange: (date: Date | null) => void;
  onExpectedDateChange?: (date: Date | null) => void;
  onSalespersonChange: (userId: string | null) => void;
  onCustomerChange: (customer: PartnerRow) => void;
  onCurrencyChange: (currency: CurrencyRow | null) => void;
  onReferenceNumberChange: (value: string) => void;
  onNotesChange: (value: string) => void;
  onTermsChange: (value: string) => void;
  onLinesChange: (lines: ProductLineItemsGridLine[]) => void;
}
