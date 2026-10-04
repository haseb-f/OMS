"use client";

import { DisclosureTrigger } from "@/components/shared/disclosure-trigger";
import { Fragment, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";

import { EnterpriseCard, EnterpriseCardContent } from "@/components/ui/card";
import { EnterpriseButton } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { SearchableSelect } from "@/components/shared/searchable-select";
import { MoneyInput } from "@/components/shared/money-input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { EnterpriseDatePicker } from "@/components/shared/date-picker";
import { EditorHeader } from "@/components/shared/detail-workspace";
import {
  FormErrorSummary,
  useFocusFirstInvalid,
  type FormErrorItem,
} from "@/components/shared/form-error-summary";
import { StatusBadge } from "@/components/business/status-badge";
import { AuditTimeline, type TimelineEntry } from "@/components/business/timeline";
import { DocumentActionBar, type DocumentAction } from "@/components/documents/document-action-bar";
import { FieldMessage } from "@/components/ui/form";
import { AllocationGrid } from "./allocation-grid";
import { PaymentSummary } from "./payment-summary";
import { useUserContext } from "@/providers/user-context";
import { useLocale } from "@/providers/locale-provider";
import { formatDate, formatDateTime } from "@/lib/date";
import { formatMoney } from "@/lib/money";
import {
  FINANCIAL_TRANSACTION_TYPE_LABEL_KEY,
  typesForDirection,
} from "@/config/financial-transactions/transaction-type";
import { financialTransactionTypesService } from "@/services/financial-transaction-types-service";
import type { FinancialTransactionTypeRow } from "@/services/financial-transaction-types-service";
import type {
  FinancialTransactionEditorConfig,
  FinancialTransactionEditorFieldErrors,
  FinancialTransactionEditorHandlers,
  FinancialTransactionEditorState,
  FinancialTransactionActivityEntry,
  TransactionEditorActionContext,
} from "./financial-transaction-editor.types";

import { paymentSourcesService } from "@/services/payment-sources-service";
import {
  receivingAccountsService,
  type ReceivingAccountOption,
} from "@/services/receiving-accounts-service";

interface LookupRow {
  id: string;
  name: string;
}

/**
 * Financial Transactions & Matching Engine (TASK-043, compacted TASK-056A)
 * — the ONE editor page-shell every financial transaction (Customer
 * Receipt/Supplier Payment) renders through, mirroring `SalesDocumentEditor`/
 * `PurchasingDocumentEditor`'s shape (config + state + handlers) but for a
 * genuinely different body: no product-line grid — a header (party/date/
 * amount/payment source/receiving account/reference/notes) and an allocation
 * section (`AllocationGrid`) instead. `renderPartyPicker` is a render prop
 * (not a hardcoded import) since this is the one editor shared between two
 * party types in the same component.
 *
 * TASK-056A — Compact Enterprise Form: single primary card, same layout
 * language as the Sales/Purchasing editor shells. Payment Source and
 * Receiving Account move into the default-visible main form (previously
 * behind "More Details") since a missing Receiving Account blocks Confirm
 * (Posting Engine requirement) — burying the field a user needs to fix that
 * error behind a disclosure was a real workflow cost, not just a cosmetic
 * one.
 */
export function FinancialTransactionEditor({
  config,
  state,
  handlers,
  activity,
  isLoading,
  disabled,
  isBusy,
  renderPartyPicker,
  allocationSection,
  fieldErrors,
  currencyCode,
}: {
  config: FinancialTransactionEditorConfig;
  state: FinancialTransactionEditorState;
  handlers: FinancialTransactionEditorHandlers;
  activity?: FinancialTransactionActivityEntry[] | null;
  isLoading?: boolean;
  disabled?: boolean;
  isBusy?: boolean;
  renderPartyPicker: (props: { disabled: boolean }) => ReactNode;
  /** The Open Invoices + "Pay All Remaining" section — supplied by the page, since it depends on which invoice table (Sales vs Purchase) to query. */
  allocationSection?: ReactNode;
  /** Inline validation messages, shown under their fields (entered data is never cleared). */
  fieldErrors?: FinancialTransactionEditorFieldErrors;
  /** Currency code shown beside the amount totals. */
  currencyCode?: string | null;
}) {
  const { t } = useLocale();
  const { hasPermission } = useUserContext();
  const fieldId = useId();
  const bodyRef = useRef<HTMLDivElement>(null);
  const focusFirstInvalid = useFocusFirstInvalid(bodyRef);
  const [paymentSources, setPaymentSources] = useState<LookupRow[]>([]);
  const [receivingAccounts, setReceivingAccounts] = useState<ReceivingAccountOption[]>([]);
  const [transactionTypes, setTransactionTypes] = useState<FinancialTransactionTypeRow[]>(() =>
    typesForDirection(config.direction).map((type) => ({
      code: type.code,
      label: type.code,
      direction: type.direction,
      isSystem: true,
    })),
  );

  useEffect(() => {
    paymentSourcesService
      .list()
      .then(setPaymentSources)
      .catch(() => setPaymentSources([]));
    receivingAccountsService
      .list()
      .then(setReceivingAccounts)
      .catch(() => setReceivingAccounts([]));
    financialTransactionTypesService
      .list(config.direction)
      .then(setTransactionTypes)
      .catch(() =>
        setTransactionTypes(
          typesForDirection(config.direction).map((type) => ({
            code: type.code,
            label: type.code,
            direction: type.direction,
            isSystem: true,
          })),
        ),
      );
  }, [config.direction]);

  /** Smart default for a new voucher: the account flagged default, or the only one. */
  const { document: currentDocument, receivingAccountId: currentReceivingAccountId } = state;
  const { onReceivingAccountChange } = handlers;
  useEffect(() => {
    if (currentDocument || currentReceivingAccountId || receivingAccounts.length === 0) return;
    const preferred =
      receivingAccounts.find((account) => account.isDefault) ??
      (receivingAccounts.length === 1 ? receivingAccounts[0] : undefined);
    if (preferred) onReceivingAccountChange(preferred.id);
  }, [currentDocument, currentReceivingAccountId, receivingAccounts, onReceivingAccountChange]);

  const currentStatusOption = config.statusOptions.find((option) => option.value === state.status);

  // The shared document action bar: one primary (legacy `variant: "default"`
  // maps to it), secondary/destructive actions in "More", confirmations
  // (e.g. Cancel) inside the bar, pinned to the bottom on phones.
  const barActions = useMemo<DocumentAction<TransactionEditorActionContext>[]>(
    () =>
      config.workflowActions.map((action) => ({
        key: action.key,
        label: action.label,
        icon: action.icon,
        primary: action.primary ?? action.variant === "default",
        destructive: action.destructive ?? action.variant === "destructive",
        visibleForStatuses: action.visibleForStatuses,
        confirm: action.confirm,
        onAction: action.onAction,
      })),
    [config.workflowActions],
  );

  const canEdit = hasPermission(config.permissions.edit) && !disabled;

  const activityEntries: TimelineEntry[] = (activity ?? []).map((entry) => ({
    id: entry.id,
    title: entry.description,
    timestamp: formatDateTime(entry.createdAt),
    status: entry.type.includes("CANCEL")
      ? "rejected"
      : entry.type.includes("CONFIRM")
        ? "done"
        : "pending",
  }));

  const summaryItems = (
    [
      fieldErrors?.party
        ? { fieldId: "party", label: config.partyLabel, message: fieldErrors.party }
        : null,
      fieldErrors?.amount
        ? {
            fieldId: "amount",
            label: t("financialTransactions.fields.amount"),
            message: fieldErrors.amount,
          }
        : null,
      fieldErrors?.receivingAccount
        ? {
            fieldId: "receivingAccount",
            label: t("financialTransactions.fields.receivingAccount"),
            message: fieldErrors.receivingAccount,
          }
        : null,
      fieldErrors?.allocations
        ? {
            fieldId: "allocations",
            label: t("financialTransactions.sections.allocations"),
            message: fieldErrors.allocations,
          }
        : null,
      fieldErrors?.form ? { message: fieldErrors.form } : null,
    ] as (FormErrorItem | null)[]
  ).filter((item): item is FormErrorItem => item !== null);

  // Focus moves once to the first invalid field when a failed save surfaces new problems.
  const errorSignature = summaryItems.map((item) => item.fieldId ?? item.message).join("|");
  const lastSignature = useRef("");
  useEffect(() => {
    if (errorSignature && errorSignature !== lastSignature.current) focusFirstInvalid();
    lastSignature.current = errorSignature;
  }, [errorSignature, focusFirstInvalid]);

  if (isLoading) {
    return <div className="p-8 text-caption text-muted-foreground">{t("common.loading")}</div>;
  }

  // Key meta: date · amount — each part isolated so LTR values never reorder in Arabic.
  const metaParts = [
    state.transactionDate ? formatDate(state.transactionDate) : null,
    state.amount ? `${formatMoney(state.amount)} ${currencyCode ?? ""}`.trim() : null,
  ].filter((part): part is string => Boolean(part));
  const meta =
    metaParts.length > 0 ? (
      <>
        {metaParts.map((part, index) => (
          <Fragment key={index}>
            {index > 0 ? " · " : null}
            <bdi>{part}</bdi>
          </Fragment>
        ))}
      </>
    ) : undefined;

  return (
    <EnterpriseCard size="sm" className="overflow-visible pb-20 md:pb-(--card-spacing)">
      <EnterpriseCardContent ref={bodyRef} data-form-scope="" className="flex flex-col gap-3">
        <EditorHeader
          sticky
          meta={meta}
          title={config.title}
          documentNumber={
            // EditorHeader puts the number in a dir="ltr" span; this keeps the gap on the title side in RTL.
            <span>{state.documentNumber ?? `${config.docCodePreview ?? ""}-…`}</span>
          }
          copyValue={state.documentNumber}
          status={
            currentStatusOption ? (
              <StatusBadge label={currentStatusOption.label} tone={currentStatusOption.tone} />
            ) : null
          }
          actions={
            <DocumentActionBar
              status={state.status}
              actions={barActions}
              context={{ document: state.document }}
              leading={config.toolbarExtra}
              isBusy={isBusy}
            />
          }
        />

        <FormErrorSummary errors={summaryItems} className="mb-0" />

        {/* Main form — compact grid, default-visible fields only; the party takes two columns. */}
        <div className="grid grid-cols-1 gap-x-3 gap-y-2 sm:grid-cols-2 lg:grid-cols-4">
          <div className="flex flex-col gap-1">
            <label htmlFor={`${fieldId}-type`} className="text-caption text-muted-foreground">
              {t("financialTransactions.fields.type")}
            </label>
            <Select value={config.transactionType} disabled>
              <SelectTrigger id={`${fieldId}-type`} size="sm" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {transactionTypes.map((type) => (
                  <SelectItem key={type.code} value={type.code}>
                    {t(FINANCIAL_TRANSACTION_TYPE_LABEL_KEY[type.code])}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div
            data-field-name="party"
            data-invalid={fieldErrors?.party ? "true" : undefined}
            className="flex min-w-0 flex-col gap-1 lg:col-span-2"
          >
            <label className="text-caption text-muted-foreground">{config.partyLabel}</label>
            {renderPartyPicker({ disabled: !canEdit })}
            <FieldMessage>{fieldErrors?.party}</FieldMessage>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-caption text-muted-foreground">
              {t("financialTransactions.fields.transactionDate")}
            </label>
            <EnterpriseDatePicker
              value={state.transactionDate}
              onChange={handlers.onTransactionDateChange}
              disabled={!canEdit}
            />
          </div>
          <div
            data-field-name="amount"
            data-invalid={fieldErrors?.amount ? "true" : undefined}
            className="flex min-w-0 flex-col gap-1"
          >
            <label htmlFor={`${fieldId}-amount`} className="text-caption text-muted-foreground">
              {t("financialTransactions.fields.amount")}
            </label>
            <MoneyInput
              id={`${fieldId}-amount`}
              // A payment / receipt amount must be > 0: unset stays empty (placeholder), never a 0 to delete.
              value={state.amount || ""}
              disabled={!canEdit}
              aria-invalid={fieldErrors?.amount ? true : undefined}
              onChange={(event) => handlers.onAmountChange(event.target.valueAsNumber || 0)}
            />
            <FieldMessage>{fieldErrors?.amount}</FieldMessage>
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor={`${fieldId}-source`} className="text-caption text-muted-foreground">
              {t("financialTransactions.fields.paymentSource")}
            </label>
            <SearchableSelect
              id={`${fieldId}-source`}
              value={state.paymentSourceId}
              disabled={!canEdit}
              onValueChange={(value) => handlers.onPaymentSourceChange(value || null)}
              options={paymentSources.map((source) => ({ value: source.id, label: source.name }))}
              allowClear
            />
          </div>
          <div
            data-field-name="receivingAccount"
            data-invalid={fieldErrors?.receivingAccount ? "true" : undefined}
            className="flex min-w-0 flex-col gap-1"
          >
            <label htmlFor={`${fieldId}-receiving`} className="text-caption text-muted-foreground">
              {t("financialTransactions.fields.receivingAccount")}
            </label>
            <SearchableSelect
              id={`${fieldId}-receiving`}
              value={state.receivingAccountId}
              disabled={!canEdit}
              onValueChange={(value) => handlers.onReceivingAccountChange(value || null)}
              options={receivingAccounts.map((account) => ({
                value: account.id,
                label: account.name,
              }))}
              allowClear
              error={Boolean(fieldErrors?.receivingAccount)}
            />
            <FieldMessage>{fieldErrors?.receivingAccount}</FieldMessage>
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor={`${fieldId}-reference`} className="text-caption text-muted-foreground">
              {t("financialTransactions.fields.referenceNumber")}
            </label>
            <Input
              id={`${fieldId}-reference`}
              dir="auto"
              value={state.referenceNumber}
              disabled={!canEdit}
              onChange={(event) => handlers.onReferenceNumberChange(event.target.value)}
            />
          </div>
        </div>

        {/* Allocation section — immediately below the main form, divided by a hairline */}
        <div
          data-field-name="allocations"
          data-invalid={fieldErrors?.allocations ? "true" : undefined}
          className="flex min-w-0 flex-col gap-2 border-t border-border pt-3"
        >
          <h2 className="text-card-title font-heading">
            {t("financialTransactions.sections.allocations")}
          </h2>
          {allocationSection}
          <AllocationGrid
            lines={state.allocations}
            onChange={handlers.onAllocationsChange}
            disabled={!canEdit}
            documentLabel={config.allocationDocumentLabel}
          />
          <FieldMessage>{fieldErrors?.allocations}</FieldMessage>
        </div>

        {/* Totals — the shared document totals block, aligned to the numeric edge */}
        <PaymentSummary
          amount={state.amount}
          allocations={state.allocations}
          currency={currencyCode}
        />
        <FieldMessage>{fieldErrors?.form}</FieldMessage>

        {/* Notes */}
        <div className="flex flex-col gap-1">
          <label htmlFor={`${fieldId}-notes`} className="text-caption text-muted-foreground">
            {t("sales.editor.sections.notes")}
          </label>
          <Textarea
            id={`${fieldId}-notes`}
            value={state.notes}
            disabled={!canEdit}
            onChange={(event) => handlers.onNotesChange(event.target.value)}
            rows={2}
          />
        </div>

        {/* Everything else — collapsed by default, flat inside the same card (no nested card) */}
        <Collapsible>
          <CollapsibleTrigger asChild>
            <DisclosureTrigger>{t("sales.editor.sections.moreDetails")}</DisclosureTrigger>
          </CollapsibleTrigger>
          <CollapsibleContent className="flex flex-col gap-4 border-t border-border pt-4">
            <div>
              <p className="mb-1 text-caption font-medium text-muted-foreground">
                {t("sales.editor.sidebar.activity")}
              </p>
              {activity === undefined || activity === null ? (
                <p className="text-caption text-muted-foreground">{t("common.loading")}</p>
              ) : activityEntries.length === 0 ? (
                <p className="text-caption text-muted-foreground">{t("common.noActivity")}</p>
              ) : (
                <AuditTimeline entries={activityEntries} />
              )}
            </div>
          </CollapsibleContent>
        </Collapsible>
      </EnterpriseCardContent>
    </EnterpriseCard>
  );
}
