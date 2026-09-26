"use client";

import { useEffect, useId, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
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
import { StatusBadge } from "@/components/business/status-badge";
import { AuditTimeline, type TimelineEntry } from "@/components/business/timeline";
import { AllocationGrid } from "./allocation-grid";
import { PaymentSummary } from "./payment-summary";
import { useUserContext } from "@/providers/user-context";
import { useLocale } from "@/providers/locale-provider";
import { formatDateTime, formatDate } from "@/lib/date";
import {
  FINANCIAL_TRANSACTION_TYPE_LABEL_KEY,
  typesForDirection,
} from "@/config/financial-transactions/transaction-type";
import { financialTransactionTypesService } from "@/services/financial-transaction-types-service";
import type { FinancialTransactionTypeRow } from "@/services/financial-transaction-types-service";
import type {
  FinancialTransactionEditorConfig,
  FinancialTransactionEditorHandlers,
  FinancialTransactionEditorState,
  FinancialTransactionActivityEntry,
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
}) {
  const { t } = useLocale();
  const { hasPermission } = useUserContext();
  const fieldId = useId();
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
  const visibleActions = config.workflowActions.filter(
    (action) => !action.visibleForStatuses || action.visibleForStatuses.includes(state.status),
  );

  const canEdit = hasPermission(config.permissions.edit) && !disabled;

  const allocatedTotal = state.allocations.reduce((sum, line) => sum + line.allocatedAmount, 0);

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

  if (isLoading) {
    return <div className="p-8 text-caption text-muted-foreground">{t("common.loading")}</div>;
  }

  return (
    <EnterpriseCard size="sm">
      <EnterpriseCardContent className="flex flex-col gap-3">
        <EditorHeader
          title={config.title}
          documentNumber={state.documentNumber ?? `${config.docCodePreview ?? ""}-…`}
          status={
            currentStatusOption ? (
              <StatusBadge label={currentStatusOption.label} tone={currentStatusOption.tone} />
            ) : null
          }
          actions={
            <>
              {config.toolbarExtra}
              {visibleActions.map((action) => {
                const Icon = action.icon;
                return (
                  <EnterpriseButton
                    key={action.key}
                    type="button"
                    variant={action.variant ?? "ghost"}
                    size="sm"
                    className="gap-1.5"
                    disabled={isBusy}
                    onClick={() => action.onAction({ document: state.document })}
                  >
                    {Icon && <Icon className="size-3.5" />}
                    {action.label}
                  </EnterpriseButton>
                );
              })}
            </>
          }
        />

        {/* Main form — compact grid, default-visible fields only */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
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
          <div className="flex flex-col gap-1">
            <label className="text-caption text-muted-foreground">{config.partyLabel}</label>
            {renderPartyPicker({ disabled: !canEdit })}
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
          <div className="flex flex-col gap-1">
            <label className="text-caption text-muted-foreground">
              {t("financialTransactions.fields.amount")}
            </label>
            <MoneyInput
              inputSize="sm"
              value={state.amount}
              disabled={!canEdit}
              onChange={(event) => handlers.onAmountChange(event.target.valueAsNumber || 0)}
            />
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
          <div className="flex flex-col gap-1">
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
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-caption text-muted-foreground">
              {t("financialTransactions.fields.referenceNumber")}
            </label>
            <Input
              inputSize="sm"
              value={state.referenceNumber}
              disabled={!canEdit}
              onChange={(event) => handlers.onReferenceNumberChange(event.target.value)}
            />
          </div>
        </div>

        {/* Allocation section — immediately below the main form */}
        <div className="flex flex-col gap-2">
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
        </div>

        {/* Summary — compact, right-aligned, inside the same card */}
        <PaymentSummary
          amount={state.amount}
          allocatedTotal={allocatedTotal}
          extraRows={[
            {
              label: t("financialTransactions.fields.type"),
              value: t(FINANCIAL_TRANSACTION_TYPE_LABEL_KEY[config.transactionType]),
            },
            {
              label: t("financialTransactions.fields.transactionDate"),
              value: state.transactionDate ? formatDate(state.transactionDate) : "—",
            },
          ]}
        />

        {/* Notes */}
        <div className="flex flex-col gap-1">
          <label className="text-caption text-muted-foreground">
            {t("sales.editor.sections.notes")}
          </label>
          <Textarea
            value={state.notes}
            disabled={!canEdit}
            onChange={(event) => handlers.onNotesChange(event.target.value)}
            rows={2}
          />
        </div>

        {/* Everything else — collapsed by default, flat inside the same card (no nested card) */}
        <Collapsible>
          <CollapsibleTrigger asChild>
            <EnterpriseButton
              type="button"
              variant="ghost"
              size="sm"
              className="group w-fit gap-1.5 text-muted-foreground"
            >
              <ChevronDown className="size-3.5 transition-transform group-data-[state=open]:rotate-180" />
              {t("sales.editor.sections.moreDetails")}
            </EnterpriseButton>
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
