"use client";

import type { ReactNode } from "react";
import {
  CommercialDocumentEditor,
  type CommercialDocumentActivityEntry,
} from "@/components/documents/commercial-document-editor";
import { useUserContext } from "@/providers/user-context";
import type {
  PurchaseDocumentEditorConfig,
  PurchaseDocumentEditorHandlers,
  PurchaseDocumentEditorState,
} from "./purchasing-document-editor.types";

/**
 * Purchasing adapter over the shared `CommercialDocumentEditor` — the
 * supplier-side mapping of the same editor Sales uses (purchasable product
 * catalog, supplier picker, optional fixed-asset/prepaid line treatment).
 */
export function PurchasingDocumentEditor<TDocument>({
  config,
  state,
  handlers,
  activity,
  isLoading,
  isTotalsLoading,
  disabled,
  isBusy,
  paymentSummary,
}: {
  config: PurchaseDocumentEditorConfig<TDocument>;
  state: PurchaseDocumentEditorState<TDocument>;
  handlers: PurchaseDocumentEditorHandlers;
  activity?: CommercialDocumentActivityEntry[] | null;
  isLoading?: boolean;
  isTotalsLoading?: boolean;
  disabled?: boolean;
  isBusy?: boolean;
  paymentSummary?: ReactNode;
}) {
  const { hasPermission } = useUserContext();
  const canEdit = hasPermission(config.permissions.edit) && !disabled;

  return (
    <CommercialDocumentEditor
      title={config.title}
      documentNumber={state.documentNumber}
      docCodePreview={config.numbering.docCodePreview}
      status={state.status}
      statusOptions={config.statusOptions}
      party={{
        role: "SUPPLIER",
        labelKey: "purchasing.editor.sections.supplier",
        value: state.supplier,
        onChange: handlers.onSupplierChange,
      }}
      documentDate={state.documentDate}
      onDocumentDateChange={handlers.onDocumentDateChange}
      currency={state.currency}
      onCurrencyChange={handlers.onCurrencyChange}
      referenceNumber={state.referenceNumber}
      onReferenceNumberChange={handlers.onReferenceNumberChange}
      notes={state.notes}
      onNotesChange={handlers.onNotesChange}
      terms={state.terms}
      onTermsChange={handlers.onTermsChange}
      lines={state.lines}
      onLinesChange={handlers.onLinesChange}
      lineMode="purchase"
      requireWarehouse={config.requireWarehouse ?? true}
      enableLineTreatment={config.enableLineTreatment}
      totals={state.totals}
      isTotalsLoading={isTotalsLoading}
      actions={config.workflowActions}
      actionContext={{ document: state.document, lines: state.lines, supplier: state.supplier }}
      toolbarExtra={config.toolbarExtra}
      trace={config.trace}
      paymentSummary={paymentSummary}
      activity={activity}
      isLoading={isLoading}
      canEdit={canEdit}
      isBusy={isBusy}
    />
  );
}
