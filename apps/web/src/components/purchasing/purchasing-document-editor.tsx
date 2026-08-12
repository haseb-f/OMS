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
import { StatusBadge } from "@/components/business/status-badge";
import { AuditTimeline, type TimelineEntry } from "@/components/business/timeline";
import { SupplierPicker } from "@/components/business/supplier-picker";
import { ProductLineItemsGrid } from "@/components/sales/product-line-items-grid";
import { DocumentTotalsFooter } from "@/components/sales/document-totals-footer";
import type { PurchaseDocumentActivityEntry } from "./purchasing-document-editor.types";
import { useCompany } from "@/providers/company-provider";
import { useUserContext } from "@/providers/user-context";
import { useLocale } from "@/providers/locale-provider";
import { useCurrencies } from "@/hooks/use-reference-data";
import { formatDateTime } from "@/lib/date";
import type {
  PurchaseDocumentEditorConfig,
  PurchaseDocumentEditorHandlers,
  PurchaseDocumentEditorState,
} from "./purchasing-document-editor.types";

function formatMoney(value: number) {
  return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * Purchasing Document Editor Foundation (TASK-048, compacted TASK-056A) —
 * the ONE editor page-shell every Purchasing document (Quotation/Order/
 * Invoice/Return) renders through, forked from `SalesDocumentEditor` with
 * `SupplierPicker` swapping in for `CustomerPicker` (the editor shell
 * imports its party picker directly rather than taking it as a generic slot
 * — the same "one shell per business domain" choice the Sales shell itself
 * made, see that component's own doc comment). `ProductLineItemsGrid`/
 * `DocumentTotalsFooter` are reused as-is (party-agnostic, TASK-037) —
 * never forked. Layout mirrors `SalesDocumentEditor`'s TASK-056A compact
 * single-card redesign exactly — keep both in sync.
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
  activity?: PurchaseDocumentActivityEntry[] | null;
  isLoading?: boolean;
  isTotalsLoading?: boolean;
  disabled?: boolean;
  isBusy?: boolean;
  /** TASK-060B Part 6 — only Purchase Invoice passes this (`<InvoicePaymentSummary />`); Quotations/Orders/Returns have no independent Payment Status. */
  paymentSummary?: ReactNode;
}) {
  const { t } = useLocale();
  const { activeCompany } = useCompany();
  const { hasPermission } = useUserContext();
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
      <EnterpriseCardContent className="flex flex-col gap-4">
        {/* Header + Toolbar — one row */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 pb-3">
          <div className="flex items-center gap-3">
            <div>
              <h1 className="text-page-title font-semibold">{config.title}</h1>
              <p dir="ltr" className="text-caption text-muted-foreground">
                {state.documentNumber ?? `${config.numbering.docCodePreview ?? ""}-…`}
              </p>
            </div>
            {currentStatusOption && (
              <StatusBadge label={currentStatusOption.label} tone={currentStatusOption.tone} />
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
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
                      supplier: state.supplier,
                    })
                  }
                >
                  {Icon && <Icon className="size-3.5" />}
                  {action.label}
                </EnterpriseButton>
              );
            })}
          </div>
        </div>

        {/* Main form — compact grid, default-visible fields only */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="flex flex-col gap-1">
            <label className="text-caption text-muted-foreground">
              {t("purchasing.editor.sections.supplier")}
            </label>
            <SupplierPicker
              value={state.supplier}
              onChange={handlers.onSupplierChange}
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
          <CollapsibleContent className="flex flex-col gap-4 border-t border-border/60 pt-4">
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
              </div>
            </div>

            {state.supplier && (
              <div>
                <p className="mb-2 text-caption font-medium text-muted-foreground">
                  {t("purchasing.editor.sidebar.supplierSummary")}
                </p>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <p className="text-caption text-muted-foreground">
                      {t("purchasing.suppliers.fields.creditLimit")}
                    </p>
                    <p dir="ltr" className="text-sm font-semibold">
                      {state.supplier.creditLimit
                        ? formatMoney(Number(state.supplier.creditLimit))
                        : "—"}
                    </p>
                  </div>
                  <div>
                    <p className="text-caption text-muted-foreground">
                      {t("purchasing.suppliers.fields.paymentTerm")}
                    </p>
                    <p className="text-sm font-semibold">{state.supplier.paymentTerm ?? "—"}</p>
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
