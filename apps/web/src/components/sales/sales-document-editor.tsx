"use client";

import { useId, type ReactNode } from "react";
import { UserPicker } from "@/components/business/user-picker";
import { EnterpriseDatePicker } from "@/components/shared/date-picker";
import {
  CommercialDocumentEditor,
  type CommercialDocumentActivityEntry,
} from "@/components/documents/commercial-document-editor";
import { useUserContext } from "@/providers/user-context";
import { useLocale } from "@/providers/locale-provider";
import type {
  SalesDocumentEditorConfig,
  SalesDocumentEditorHandlers,
  SalesDocumentEditorState,
} from "./sales-document-editor.types";

function formatMoney(value: number) {
  return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * Sales adapter over the shared `CommercialDocumentEditor` — maps the
 * Sales config/state/handlers contract (customer, salesperson, expected
 * date, customer balance) onto the one editor every commercial document
 * renders through. Layout and behavior live in the shared editor only.
 */
export function SalesDocumentEditor<TDocument>({
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
  config: SalesDocumentEditorConfig<TDocument>;
  state: SalesDocumentEditorState<TDocument>;
  handlers: SalesDocumentEditorHandlers;
  activity?: CommercialDocumentActivityEntry[] | null;
  isLoading?: boolean;
  isTotalsLoading?: boolean;
  /** Disables the form fields only — never the action bar (see `isBusy`). */
  disabled?: boolean;
  /** Disables action buttons while a request is in flight. */
  isBusy?: boolean;
  paymentSummary?: ReactNode;
}) {
  const { t } = useLocale();
  const { hasPermission } = useUserContext();
  const salespersonFieldId = useId();
  const canEdit = hasPermission(config.permissions.edit) && !disabled;

  const moreDetails = (
    <>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="flex flex-col gap-1">
          <label htmlFor={salespersonFieldId} className="text-caption text-muted-foreground">
            {t("sales.editor.header.salesperson")}
          </label>
          {/* Cleared ("") is "no salesperson" (null), as the old "__none__" row was. */}
          <UserPicker
            id={salespersonFieldId}
            value={state.salespersonId ?? ""}
            onValueChange={(userId) => handlers.onSalespersonChange(userId || null)}
            activeOnly={false}
            allowClear
            disabled={!canEdit}
            placeholder={t("sales.editor.header.noSalesperson")}
          />
        </div>
        {handlers.onExpectedDateChange ? (
          <div className="flex flex-col gap-1">
            <label className="text-caption text-muted-foreground">
              {t("sales.editor.header.expectedDate")}
            </label>
            <EnterpriseDatePicker
              value={state.expectedDate ?? null}
              onChange={handlers.onExpectedDateChange}
              disabled={!canEdit}
            />
          </div>
        ) : null}
      </div>
      {state.customer ? (
        <div>
          <p className="mb-2 text-caption font-medium text-muted-foreground">
            {t("sales.editor.sidebar.customerSummary")}
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <p className="text-caption text-muted-foreground">
                {t("sales.customers.fields.balance")}
              </p>
              <p dir="ltr" className="text-sm font-semibold tabular-nums">
                {typeof state.customer.receivableBalance === "number"
                  ? formatMoney(state.customer.receivableBalance)
                  : "—"}
              </p>
            </div>
            <div>
              <p className="text-caption text-muted-foreground">
                {t("sales.customers.fields.creditLimit")}
              </p>
              <p dir="ltr" className="text-sm font-semibold tabular-nums">
                {state.customer.customerProfile?.creditLimit
                  ? formatMoney(Number(state.customer.customerProfile.creditLimit))
                  : "—"}
              </p>
            </div>
            <div>
              <p className="text-caption text-muted-foreground">
                {t("sales.customers.fields.paymentTerm")}
              </p>
              <p className="text-sm font-semibold">
                {state.customer.customerProfile?.paymentTerm?.name ?? "—"}
              </p>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );

  return (
    <CommercialDocumentEditor
      title={config.title}
      documentNumber={state.documentNumber}
      docCodePreview={config.numbering.docCodePreview}
      status={state.status}
      statusOptions={config.statusOptions}
      party={{
        role: "CUSTOMER",
        labelKey: "sales.editor.sections.customer",
        value: state.customer,
        onChange: handlers.onCustomerChange,
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
      lineMode="sales"
      requireWarehouse={config.requireWarehouse ?? true}
      totals={state.totals}
      isTotalsLoading={isTotalsLoading}
      actions={config.workflowActions}
      actionContext={{ document: state.document, lines: state.lines, customer: state.customer }}
      toolbarExtra={config.toolbarExtra}
      trace={config.trace}
      moreDetails={moreDetails}
      paymentSummary={paymentSummary}
      activity={activity}
      isLoading={isLoading}
      canEdit={canEdit}
      isBusy={isBusy}
    />
  );
}
