"use client";

import { DisclosureTrigger } from "@/components/shared/disclosure-trigger";
import { Fragment, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";

import { EnterpriseCard, EnterpriseCardContent } from "@/components/ui/card";
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
import { FormSection } from "@/components/documents/form-section";
import {
  FormErrorSummary,
  useFocusFirstInvalid,
  type FormErrorItem,
} from "@/components/shared/form-error-summary";
import { StatusBadge } from "@/components/business/status-badge";
import { CurrencyPicker } from "@/components/business/currency-picker";
import { AuditTimeline, type TimelineEntry } from "@/components/business/timeline";
import { DocumentActionBar, type DocumentAction } from "@/components/documents/document-action-bar";
import { FieldMessage, RequiredMark } from "@/components/ui/form";
import { AllocationGrid } from "./allocation-grid";
import { PaymentSummary } from "./payment-summary";
import { useUserContext } from "@/providers/user-context";
import { useLocale } from "@/providers/locale-provider";
import { useFunctionalCurrencyCode } from "@/hooks/use-functional-currency";
import { formatDate, formatDateTime } from "@/lib/date";
import { formatMoney } from "@/lib/money";
import {
  offersPurposeChoice,
  purposeDefinition,
  purposesFor,
  type VoucherPurposeDefinition,
} from "@/config/financial-transactions/voucher-purpose";
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
import { counterAccountsService, type CounterAccountOption } from "@/services/voucher-services";

interface LookupRow {
  id: string;
  name: string;
}

/** The purposes the card offers: explicit config, else every purpose for a receipt / supplier payment. */
function resolvePurposes(config: FinancialTransactionEditorConfig): VoucherPurposeDefinition[] {
  if (config.purposes === false) return [];
  if (config.purposes) return config.purposes;
  return offersPurposeChoice(config.transactionType) ? purposesFor(config.direction) : [];
}

/**
 * Financial Transactions & Matching Engine (TASK-043, compacted TASK-056A,
 * R22 voucher card) — the ONE editor shell every financial transaction
 * (receipt, supplier payment, other receipt / payment, transfer, expense,
 * refund) renders through: config + state + handlers, `renderPartyPicker` as
 * a render prop (the one editor shared between party types).
 *
 * R22 §3 — receipts and supplier payments are a short progressive card:
 * (1) purpose and party / counter-account, (2) amount, currency, method,
 * money account and date, (3) the invoices this voucher settles — only for
 * invoice settlement, once a party is chosen — then a review before Confirm
 * (built by the page from the same state). Fields a purpose does not use are
 * not shown. Expense and refund vouchers keep their single compact form.
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
  showAllocations = true,
  extraFields,
  afterMainForm,
  purposeLocked,
}: {
  config: FinancialTransactionEditorConfig;
  state: FinancialTransactionEditorState;
  handlers: FinancialTransactionEditorHandlers;
  activity?: FinancialTransactionActivityEntry[] | null;
  isLoading?: boolean;
  disabled?: boolean;
  isBusy?: boolean;
  renderPartyPicker: (props: { disabled: boolean; id: string }) => ReactNode;
  /**
   * The invoices table of an invoice-settlement voucher (open invoices with an
   * inline "this voucher" amount) — supplied by the page, since it depends on
   * which invoice table (Sales vs Purchase) to query. When given it is the one
   * allocation surface; otherwise the generic allocation grid is shown.
   */
  allocationSection?: ReactNode;
  /** Inline validation messages, shown under their fields (entered data is never cleared). */
  fieldErrors?: FinancialTransactionEditorFieldErrors;
  /** Currency code shown inside the amount field and beside the totals (else the base currency). */
  currencyCode?: string | null;
  /** False for a voucher that never settles documents (expense vouchers): no allocation grid / totals. */
  showAllocations?: boolean;
  /** Further main-form fields (each a grid cell), after Reference — e.g. an expense's currency and dimensions. */
  extraFields?: ReactNode;
  /** Shown right under the main form (notices such as open supplier invoices, posting status). */
  afterMainForm?: ReactNode;
  /** A saved voucher keeps its type: the purpose choice is read-only. */
  purposeLocked?: boolean;
}) {
  const { t } = useLocale();
  const { hasPermission } = useUserContext();
  const fieldId = useId();
  const bodyRef = useRef<HTMLDivElement>(null);
  const focusFirstInvalid = useFocusFirstInvalid(bodyRef);
  const [paymentSources, setPaymentSources] = useState<LookupRow[]>([]);
  const [receivingAccounts, setReceivingAccounts] = useState<ReceivingAccountOption[]>([]);
  const [counterAccounts, setCounterAccounts] = useState<CounterAccountOption[] | null>(null);

  const purposes = resolvePurposes(config);
  const hasPurposeChoice = purposes.length > 0;
  const purpose = hasPurposeChoice
    ? purposeDefinition(config.direction, state.purpose ?? purposes[0].purpose)
    : null;
  const needsParty = purpose ? purpose.needsParty : true;
  const needsCounterAccount = purpose?.needsCounterAccount ?? false;
  const isTransfer = purpose?.needsTargetAccount ?? false;
  const settlesInvoices = purpose ? purpose.needsAllocation : showAllocations;

  const baseCurrencyCode = useFunctionalCurrencyCode(!currencyCode);
  const shownCurrency = currencyCode || baseCurrencyCode || null;

  useEffect(() => {
    paymentSourcesService
      .list()
      .then(setPaymentSources)
      .catch(() => setPaymentSources([]));
    receivingAccountsService
      .list()
      .then(setReceivingAccounts)
      .catch(() => setReceivingAccounts([]));
  }, []);

  useEffect(() => {
    if (!needsCounterAccount) return;
    let cancelled = false;
    counterAccountsService
      .list(config.direction)
      .then((rows) => {
        if (!cancelled) setCounterAccounts(rows);
      })
      .catch(() => {
        if (!cancelled) setCounterAccounts([]);
      });
    return () => {
      cancelled = true;
    };
  }, [needsCounterAccount, config.direction]);

  /** Smart default for a new voucher: the account flagged default, or the only one (D7: the review names it). */
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
  // (e.g. Cancel, the R22 review) inside the bar, pinned to the bottom on phones.
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
  const amountLabel =
    config.fieldLabels?.amount ??
    t(config.direction === "IN" ? "vouchers.fields.amountIn" : "vouchers.fields.amountOut");
  const receivingAccountLabel = isTransfer
    ? t("vouchers.fields.transferFrom")
    : (config.fieldLabels?.receivingAccount ??
      t(config.direction === "IN" ? "vouchers.fields.accountIn" : "vouchers.fields.accountOut"));
  const paymentSourceLabel =
    config.fieldLabels?.paymentSource ?? t("vouchers.fields.paymentMethod");
  const counterAccountLabel = t(
    config.direction === "IN"
      ? "vouchers.fields.counterAccountIn"
      : "vouchers.fields.counterAccountOut",
  );

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
      fieldErrors?.counterAccount
        ? {
            fieldId: "counterAccount",
            label: counterAccountLabel,
            message: fieldErrors.counterAccount,
          }
        : null,
      fieldErrors?.amount
        ? { fieldId: "amount", label: amountLabel, message: fieldErrors.amount }
        : null,
      fieldErrors?.receivingAccount
        ? {
            fieldId: "receivingAccount",
            label: receivingAccountLabel,
            message: fieldErrors.receivingAccount,
          }
        : null,
      fieldErrors?.targetAccount
        ? {
            fieldId: "targetAccount",
            label: t("vouchers.fields.transferTo"),
            message: fieldErrors.targetAccount,
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
    state.amount ? `${formatMoney(state.amount)} ${shownCurrency ?? ""}`.trim() : null,
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

  const accountOptions = receivingAccounts.map((account) => ({
    value: account.id,
    label: account.name,
  }));

  // ---------------------------------------------------------------- fields
  const label = (id: string, text: string, required?: boolean) => (
    <label htmlFor={`${fieldId}-${id}`} className="text-caption text-muted-foreground">
      {text}
      {required ? <RequiredMark className="ms-0.5" /> : null}
    </label>
  );

  const purposeField = purpose ? (
    <div className="flex min-w-0 flex-col gap-1 sm:col-span-2">
      {label("type", t("financialTransactions.fields.type"))}
      <Select
        value={purpose.purpose}
        disabled={!canEdit || purposeLocked}
        onValueChange={(value) =>
          handlers.onPurposeChange?.(value as VoucherPurposeDefinition["purpose"])
        }
      >
        <SelectTrigger id={`${fieldId}-type`} size="sm" className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {purposes.map((option) => (
            <SelectItem key={option.purpose} value={option.purpose}>
              {t(option.labelKey)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="text-caption text-muted-foreground">{t(purpose.hintKey)}</p>
    </div>
  ) : null;

  const partyField = needsParty ? (
    <div
      data-field-name="party"
      data-invalid={fieldErrors?.party ? "true" : undefined}
      className="flex min-w-0 flex-col gap-1 sm:col-span-2"
    >
      {label("party", config.partyLabel, true)}
      {renderPartyPicker({ disabled: !canEdit, id: `${fieldId}-party` })}
      <FieldMessage>{fieldErrors?.party}</FieldMessage>
    </div>
  ) : null;

  const counterAccountField = needsCounterAccount ? (
    <div
      data-field-name="counterAccount"
      data-invalid={fieldErrors?.counterAccount ? "true" : undefined}
      className="flex min-w-0 flex-col gap-1 sm:col-span-2"
    >
      {label("counter", counterAccountLabel, true)}
      <SearchableSelect
        id={`${fieldId}-counter`}
        value={state.counterAccountId ?? null}
        disabled={!canEdit}
        onValueChange={(value) => handlers.onCounterAccountChange?.(value || null)}
        options={(counterAccounts ?? []).map((account) => ({
          value: account.id,
          label: `${account.code} · ${account.name}`,
          searchText: `${account.code} ${account.name}`,
        }))}
        loading={counterAccounts === null}
        placeholder={t("vouchers.counterAccounts.placeholder")}
        searchPlaceholder={t("vouchers.counterAccounts.search")}
        emptyText={t("vouchers.counterAccounts.empty")}
        error={Boolean(fieldErrors?.counterAccount)}
      />
      <FieldMessage>{fieldErrors?.counterAccount}</FieldMessage>
    </div>
  ) : null;

  const amountField = (
    <div
      data-field-name="amount"
      data-invalid={fieldErrors?.amount ? "true" : undefined}
      className={
        hasPurposeChoice
          ? "flex min-w-0 flex-col gap-1 sm:col-span-2"
          : "flex min-w-0 flex-col gap-1"
      }
    >
      {label("amount", amountLabel, true)}
      <MoneyInput
        id={`${fieldId}-amount`}
        inputSize="prominent"
        // A payment / receipt amount must be > 0: unset stays empty (placeholder), never a 0 to delete.
        value={state.amount || ""}
        placeholder={t("vouchers.fields.amountPlaceholder")}
        adornment={shownCurrency ?? undefined}
        disabled={!canEdit}
        aria-invalid={fieldErrors?.amount ? true : undefined}
        onValueChange={(value) => handlers.onAmountChange(value ?? 0)}
      />
      <FieldMessage>{fieldErrors?.amount}</FieldMessage>
    </div>
  );

  // A settlement voucher's currency is its invoices'; other purposes choose it (empty = base).
  const currencyField =
    handlers.onCurrencyChange && !settlesInvoices ? (
      <div className="flex min-w-0 flex-col gap-1">
        {label("currency", t("vouchers.fields.currency"))}
        <CurrencyPicker
          id={`${fieldId}-currency`}
          valueKey="id"
          value={state.currencyId ?? ""}
          disabled={!canEdit}
          allowClear
          placeholder={t("vouchers.fields.baseCurrency")}
          onValueChange={(value) => handlers.onCurrencyChange?.(value || null)}
        />
      </div>
    ) : null;

  const dateField = (
    <div className="flex min-w-0 flex-col gap-1">
      {label(
        "date",
        config.fieldLabels?.transactionDate ?? t("financialTransactions.fields.transactionDate"),
      )}
      <EnterpriseDatePicker
        id={`${fieldId}-date`}
        value={state.transactionDate}
        onChange={handlers.onTransactionDateChange}
        disabled={!canEdit}
      />
    </div>
  );

  const paymentSourceField = isTransfer ? null : (
    <div className="flex min-w-0 flex-col gap-1">
      {label("source", paymentSourceLabel)}
      <SearchableSelect
        id={`${fieldId}-source`}
        value={state.paymentSourceId}
        disabled={!canEdit}
        onValueChange={(value) => handlers.onPaymentSourceChange(value || null)}
        options={paymentSources.map((source) => ({ value: source.id, label: source.name }))}
        allowClear
      />
    </div>
  );

  const receivingAccountField = (
    <div
      data-field-name="receivingAccount"
      data-invalid={fieldErrors?.receivingAccount ? "true" : undefined}
      className="flex min-w-0 flex-col gap-1"
    >
      {label("receiving", receivingAccountLabel, isTransfer)}
      <SearchableSelect
        id={`${fieldId}-receiving`}
        value={state.receivingAccountId}
        disabled={!canEdit}
        onValueChange={(value) => handlers.onReceivingAccountChange(value || null)}
        options={accountOptions}
        allowClear
        error={Boolean(fieldErrors?.receivingAccount)}
      />
      <FieldMessage>{fieldErrors?.receivingAccount}</FieldMessage>
    </div>
  );

  const targetAccountField = isTransfer ? (
    <div
      data-field-name="targetAccount"
      data-invalid={fieldErrors?.targetAccount ? "true" : undefined}
      className="flex min-w-0 flex-col gap-1"
    >
      {label("target", t("vouchers.fields.transferTo"), true)}
      <SearchableSelect
        id={`${fieldId}-target`}
        value={state.targetReceivingAccountId ?? null}
        disabled={!canEdit}
        onValueChange={(value) => handlers.onTargetAccountChange?.(value || null)}
        options={accountOptions.filter((option) => option.value !== state.receivingAccountId)}
        allowClear
        error={Boolean(fieldErrors?.targetAccount)}
      />
      <FieldMessage>{fieldErrors?.targetAccount}</FieldMessage>
    </div>
  ) : null;

  const referenceField = (
    <div className="flex min-w-0 flex-col gap-1">
      {label("reference", t("financialTransactions.fields.referenceNumber"))}
      <Input
        id={`${fieldId}-reference`}
        dir="auto"
        value={state.referenceNumber}
        disabled={!canEdit}
        onChange={(event) => handlers.onReferenceNumberChange(event.target.value)}
      />
    </div>
  );

  const totals = (
    <PaymentSummary
      amount={state.amount}
      allocations={state.allocations}
      currency={shownCurrency}
    />
  );

  // ---------------------------------------------------------------- layout
  const sectionedBody = (
    <>
      <FormSection title={t("vouchers.sections.purpose")}>
        <div className="grid grid-cols-1 gap-x-3 gap-y-2 sm:grid-cols-2 lg:grid-cols-4">
          {purposeField}
          {partyField}
          {counterAccountField}
        </div>
      </FormSection>
      <FormSection title={t("vouchers.sections.amount")}>
        <div className="grid grid-cols-1 gap-x-3 gap-y-2 sm:grid-cols-2 lg:grid-cols-4">
          {amountField}
          {currencyField}
          {paymentSourceField}
          {receivingAccountField}
          {targetAccountField}
          {dateField}
          {referenceField}
          {extraFields}
        </div>
      </FormSection>
      {afterMainForm}
      {settlesInvoices && allocationSection ? (
        <FormSection
          title={t("vouchers.sections.allocation")}
          data-field-name="allocations"
          data-invalid={fieldErrors?.allocations ? "true" : undefined}
        >
          {allocationSection}
          <FieldMessage>{fieldErrors?.allocations}</FieldMessage>
          {totals}
        </FormSection>
      ) : null}
    </>
  );

  const compactBody = (
    <>
      {/* Main form — compact grid, default-visible fields only; the party takes two columns. */}
      <div className="grid grid-cols-1 gap-x-3 gap-y-2 sm:grid-cols-2 lg:grid-cols-4">
        {partyField}
        {dateField}
        {amountField}
        {paymentSourceField}
        {receivingAccountField}
        {referenceField}
        {extraFields}
      </div>
      {afterMainForm}
      {showAllocations ? (
        <>
          {/* Allocation section — immediately below the main form, divided by a hairline */}
          <div
            data-field-name="allocations"
            data-invalid={fieldErrors?.allocations ? "true" : undefined}
            className="flex min-w-0 flex-col gap-2 border-t border-border pt-3"
          >
            <h2 className="text-card-title font-heading">
              {t("financialTransactions.sections.allocations")}
            </h2>
            {allocationSection ?? (
              <AllocationGrid
                lines={state.allocations}
                onChange={handlers.onAllocationsChange}
                disabled={!canEdit}
                documentLabel={config.allocationDocumentLabel}
              />
            )}
            <FieldMessage>{fieldErrors?.allocations}</FieldMessage>
          </div>
          {totals}
        </>
      ) : null}
    </>
  );

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

        {hasPurposeChoice ? sectionedBody : compactBody}
        <FieldMessage>{fieldErrors?.form}</FieldMessage>

        {/* Notes */}
        <div className="flex flex-col gap-1">
          {label("notes", t("sales.editor.sections.notes"))}
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
