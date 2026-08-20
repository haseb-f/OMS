"use client";

import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { EnterpriseCard, EnterpriseCardContent } from "@/components/ui/card";
import { EnterpriseButton } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
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
import { CustomerPicker } from "@/components/business/customer-picker";
import { useUsersList, useCurrencies } from "@/hooks/use-reference-data";
import type { SalesDocumentActivityEntry } from "./sales-document-editor.types";
import { useCompany } from "@/providers/company-provider";
import { useUserContext } from "@/providers/user-context";
import { useLocale } from "@/providers/locale-provider";
import { formatDateTime } from "@/lib/date";
import { ProductLineItemsGrid } from "./product-line-items-grid";
import { DocumentTotalsFooter } from "./document-totals-footer";
import type {
  SalesDocumentEditorConfig,
  SalesDocumentEditorHandlers,
  SalesDocumentEditorState,
} from "./sales-document-editor.types";

function formatMoney(value: number) {
  return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * Sales Document Editor Foundation (TASK-039, redesigned TASK-040, compacted
 * TASK-056A) — the ONE editor page-shell every Sales document (Quotation/
 * Order/Invoice/Return) renders through. Fully controlled: every value comes
 * from `state`, every mutation goes through `handlers`, everything
 * document-specific comes from `config`.
 *
 * TASK-056A — Compact Enterprise Form: the whole editor (header, main form,
 * product grid, totals, notes) now lives inside ONE primary card instead of
 * floating page sections, matching every other document editor and the
 * Odoo-style "one screen, no scrolling" workflow this ERP targets. Customer,
 * Document Date, and Reference Number are the default-visible main-form
 * fields; company/branch/salesperson, customer balance/credit/payment-term,
 * terms, and the activity timeline stay behind "More Details" — now rendered
 * flat inside the same card (no nested card) rather than a separate
 * disclosure block. No business logic, workflow, or API changed — this is a
 * render-only reorganization.
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
  /** `undefined` while loading, `[]` once loaded with nothing yet, matching MasterDataPage's own activity-sheet convention. */
  activity?: SalesDocumentActivityEntry[] | null;
  isLoading?: boolean;
  isTotalsLoading?: boolean;
  /** Disables the FORM FIELDS only (e.g. the document is no longer Draft, or the caller lacks edit permission) — never the workflow action buttons, since Approve/Cancel/Print are precisely the actions meant to stay clickable once a document leaves Draft. `visibleForStatuses` on each action is what correctly governs which buttons even appear. */
  disabled?: boolean;
  /** Disables workflow action buttons during a transient in-flight request (saving/submitting/etc.) — a distinct concern from `disabled`. */
  isBusy?: boolean;
  /** TASK-060B Part 6 — only Sales Invoice passes this (`<InvoicePaymentSummary />`); Quotations/Orders/Returns have no independent Payment Status, so the shell stays generic and renders nothing when omitted. */
  paymentSummary?: ReactNode;
}) {
  const { t } = useLocale();
  const { activeCompany } = useCompany();
  const { hasPermission } = useUserContext();
  const users = useUsersList();
  const currencies = useCurrencies();

  const activeBranch = activeCompany?.branches.find(
    (branch) => branch.id === activeCompany?.defaultBranchId,
  );

  const currentStatusOption = config.statusOptions.find((option) => option.value === state.status);
  const visibleActions = config.workflowActions.filter(
    (action) => !action.visibleForStatuses || action.visibleForStatuses.includes(state.status),
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

  if (isLoading) {
    return <div className="p-8 text-caption text-muted-foreground">{t("common.loading")}</div>;
  }

  return (
    <EnterpriseCard size="sm">
      <EnterpriseCardContent className="flex flex-col gap-3">
        <EditorHeader
          title={config.title}
          documentNumber={state.documentNumber ?? `${config.numbering.docCodePreview ?? ""}-…`}
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
                    onClick={() =>
                      action.onAction({
                        document: state.document,
                        lines: state.lines,
                        customer: state.customer,
                      })
                    }
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
            <label className="text-caption text-muted-foreground">
              {t("sales.editor.sections.customer")}
            </label>
            <CustomerPicker
              value={state.customer}
              onChange={handlers.onCustomerChange}
              disabled={!canEdit}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-caption text-muted-foreground">
              {t("sales.editor.header.documentDate")}
            </label>
            <EnterpriseDatePicker
              value={state.documentDate}
              onChange={handlers.onDocumentDateChange}
              disabled={!canEdit}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-caption text-muted-foreground">
              {t("sales.editor.header.currency")}
            </label>
            <Select
              value={state.currency?.id ?? "__base__"}
              disabled={!canEdit}
              onValueChange={(value) =>
                handlers.onCurrencyChange(
                  value === "__base__" ? null : (currencies.find((c) => c.id === value) ?? null),
                )
              }
            >
              <SelectTrigger size="sm" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__base__">{t("sales.editor.header.baseCurrency")}</SelectItem>
                {currencies.map((currency) => (
                  <SelectItem key={currency.id} value={currency.id}>
                    {currency.code} — {currency.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-caption text-muted-foreground">
              {t("sales.editor.sections.referenceNumber")}
            </label>
            <Input
              inputSize="sm"
              value={state.referenceNumber}
              disabled={!canEdit}
              onChange={(event) => handlers.onReferenceNumberChange(event.target.value)}
            />
          </div>
        </div>

        {/* Product Grid — immediately below the main form */}
        <div className="flex flex-col gap-2">
          <h2 className="text-card-title font-heading">
            {t("sales.editor.sections.productLines")}
          </h2>
          <ProductLineItemsGrid
            lines={state.lines}
            onChange={handlers.onLinesChange}
            requireWarehouse={config.requireWarehouse ?? true}
            disabled={!canEdit}
            compact
          />
        </div>

        {/* Totals — compact, right-aligned, inside the same card */}
        <DocumentTotalsFooter
          totals={state.totals}
          isLoading={isTotalsLoading}
          currency={state.currency?.code}
        />
        {state.currency && (
          <p className="text-end text-xs text-muted-foreground">
            {t("sales.editor.header.currencyNote", { code: state.currency.code })}
          </p>
        )}
        {paymentSummary}

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
              <p className="mb-2 text-caption font-medium text-muted-foreground">
                {t("sales.editor.sections.documentInfo")}
              </p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <div className="flex flex-col gap-1">
                  <label className="text-caption text-muted-foreground">
                    {t("sales.editor.header.company")}
                  </label>
                  <p className="text-sm font-medium">{activeCompany?.name ?? "—"}</p>
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-caption text-muted-foreground">
                    {t("sales.editor.header.branch")}
                  </label>
                  <p className="text-sm font-medium">{activeBranch?.name ?? "—"}</p>
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-caption text-muted-foreground">
                    {t("sales.editor.header.salesperson")}
                  </label>
                  <Select
                    value={state.salespersonId ?? "__none__"}
                    disabled={!canEdit}
                    onValueChange={(value) =>
                      handlers.onSalespersonChange(value === "__none__" ? null : value)
                    }
                  >
                    <SelectTrigger size="sm" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">
                        {t("sales.editor.header.noSalesperson")}
                      </SelectItem>
                      {users.map((user) => (
                        <SelectItem key={user.id} value={user.id}>
                          {user.fullName}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {handlers.onExpectedDateChange && (
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
                )}
              </div>
            </div>

            {state.customer && (
              <div>
                <p className="mb-2 text-caption font-medium text-muted-foreground">
                  {t("sales.editor.sidebar.customerSummary")}
                </p>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <div>
                    <p className="text-caption text-muted-foreground">
                      {t("sales.customers.fields.balance")}
                    </p>
                    <p dir="ltr" className="text-sm font-semibold">
                      {typeof state.customer.balance === "number"
                        ? formatMoney(state.customer.balance)
                        : "—"}
                    </p>
                  </div>
                  <div>
                    <p className="text-caption text-muted-foreground">
                      {t("sales.customers.fields.creditLimit")}
                    </p>
                    <p dir="ltr" className="text-sm font-semibold">
                      {state.customer.creditLimit
                        ? formatMoney(Number(state.customer.creditLimit))
                        : "—"}
                    </p>
                  </div>
                  <div>
                    <p className="text-caption text-muted-foreground">
                      {t("sales.customers.fields.paymentTerm")}
                    </p>
                    <p className="text-sm font-semibold">
                      {state.customer.paymentTerm?.name ?? "—"}
                    </p>
                  </div>
                </div>
              </div>
            )}

            <div>
              <p className="mb-1 text-caption font-medium text-muted-foreground">
                {t("sales.editor.sections.terms")}
              </p>
              <Textarea
                value={state.terms}
                disabled={!canEdit}
                onChange={(event) => handlers.onTermsChange(event.target.value)}
                rows={2}
              />
            </div>

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
