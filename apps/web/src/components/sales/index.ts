/**
 * Sales Document Editor Foundation (TASK-039) — the one surface every
 * future Quotation/Sales Order/Sales Invoice/Sales Return page imports
 * from. No document-type module reaches into these files directly by
 * relative path; everything reusable is re-exported here.
 */
export { SalesDocumentEditor } from "./sales-document-editor";
export type {
  SalesDocumentEditorConfig,
  SalesDocumentEditorState,
  SalesDocumentEditorHandlers,
  SalesDocumentEditorActionContext,
  SalesDocumentStatusOption,
  SalesDocumentWorkflowAction,
  SalesDocumentWorkflowActionKey,
  SalesDocumentNumberingConfig,
  SalesDocumentPermissions,
  SalesDocumentPrintPayloadBuilder,
  SalesDocumentActivityEntry,
} from "./sales-document-editor.types";

export { ProductLineItemsGrid, createEmptyLine } from "./product-line-items-grid";
export type { ProductLineItemsGridLine } from "./product-line-items-grid";

export { DocumentTotalsFooter } from "./document-totals-footer";
export type { DocumentTotals } from "./document-totals-footer";

export { previewSalesLine, previewSalesDocumentTotals } from "./sales-line-preview-math";
export type { SalesLinePreview, SalesLinePreviewInput } from "./sales-line-preview-math";

export { SalesDocumentRowActionsMenu, SalesListBulkActions } from "./sales-document-row-actions";
export type { SalesDocumentRowAction } from "./sales-document-row-actions";
