"use client";

import { useMemo, type ReactNode } from "react";
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
import { RelatedRecordsPanel } from "@/components/shared/related-records-panel";
import { StatusBadge, type StatusTone } from "@/components/business/status-badge";
import { AuditTimeline, type TimelineEntry } from "@/components/business/timeline";
import { PartnerPicker } from "@/components/business/partner-picker";
import {
  ProductLineItemsGrid,
  type ProductLineItemsGridLine,
} from "@/components/sales/product-line-items-grid";
import {
  DocumentTotalsFooter,
  type DocumentTotals,
} from "@/components/sales/document-totals-footer";
import {
  previewSalesDocumentTotals,
  previewSalesLine,
} from "@/components/sales/sales-line-preview-math";
import { useCurrencies, useTaxes } from "@/hooks/use-reference-data";
import { useCompany } from "@/providers/company-provider";
import { useLocale } from "@/providers/locale-provider";
import { formatDateTime } from "@/lib/date";
import type { MessageKey } from "@/i18n/translate";
import type { PartnerRoleValue, PartnerRow } from "@/services/partners-service";
import type { CurrencyRow } from "@/config/master-data/entities";
import type { TraceKind } from "@/services/traceability-service";
import { DocumentActionBar, type DocumentAction } from "./document-action-bar";

export interface CommercialDocumentActivityEntry {
  id: string;
  type: string;
  description: string;
  createdAt: string;
}

export interface CommercialDocumentStatusOption {
  value: string;
  label: string;
  tone: StatusTone;
}

export interface CommercialDocumentEditorProps<TContext> {
  title: string;
  documentNumber: string | null;
  docCodePreview?: string;
  status: string;
  statusOptions: CommercialDocumentStatusOption[];
  party: {
    role: PartnerRoleValue;
    labelKey: MessageKey;
    value: PartnerRow | null;
    onChange: (partner: PartnerRow) => void;
  };
  documentDate: Date | null;
  onDocumentDateChange: (date: Date | null) => void;
  currency: CurrencyRow | null;
  onCurrencyChange: (currency: CurrencyRow | null) => void;
  referenceNumber: string;
  onReferenceNumberChange: (value: string) => void;
  notes: string;
  onNotesChange: (value: string) => void;
  terms: string;
  onTermsChange: (value: string) => void;
  lines: ProductLineItemsGridLine[];
  onLinesChange: (lines: ProductLineItemsGridLine[]) => void;
  lineMode: "sales" | "purchase";
  requireWarehouse: boolean;
  /** Purchase invoices only: per-line fixed-asset / prepaid-expense treatment. */
  enableLineTreatment?: boolean;
  /** Server totals of the saved document. While editing, a live preview (same math as the API) is shown instead. */
  totals: DocumentTotals | null;
  isTotalsLoading?: boolean;
  actions: DocumentAction<TContext>[];
  actionContext: TContext;
  /** Save — always the first control in the action bar. */
  toolbarExtra?: ReactNode;
  trace?: { kind: TraceKind; id: string | null };
  /** Extra default-visible header fields (e.g. due date). */
  headerFields?: ReactNode;
  /** Extra "More details" content (salesperson, balances…). */
  moreDetails?: ReactNode;
  paymentSummary?: ReactNode;
  activity?: CommercialDocumentActivityEntry[] | null;
  isLoading?: boolean;
  canEdit: boolean;
  isBusy?: boolean;
}

/**
 * The ONE editor every commercial document (sales and purchase quotations,
 * orders, invoices, returns) renders through: party, dates, currency,
 * product lines, live totals, terms, related records and a single-primary
 * action bar. Sales/purchasing shells are thin adapters over this, so a
 * layout or behavior fix lands in both at once.
 */
export function CommercialDocumentEditor<TContext>(props: CommercialDocumentEditorProps<TContext>) {
  const { t } = useLocale();
  const { activeCompany } = useCompany();
  const currencies = useCurrencies();
  const taxes = useTaxes();
  const { canEdit, lines, totals: serverTotals, status, statusOptions, activity } = props;

  const activeBranch = activeCompany?.branches.find(
    (branch) => branch.id === activeCompany?.defaultBranchId,
  );
  const statusOption = statusOptions.find((option) => option.value === status);

  // While the document is editable the footer mirrors what the API will
  // compute on save (identical math), so totals are never stale or blank.
  const previewTotals = useMemo<DocumentTotals | null>(() => {
    if (!canEdit) return null;
    const rateById = new Map(taxes.map((tax) => [tax.id, tax]));
    const computed = lines
      .filter((line) => line.product !== null)
      .map((line) => {
        const tax = line.taxId ? rateById.get(line.taxId) : undefined;
        return previewSalesLine({
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          discountPercent: line.discountPercent,
          taxRatePercent: tax ? Number(tax.rate) : undefined,
          taxInclusive: tax ? Boolean(tax.inclusive) : undefined,
        });
      });
    return previewSalesDocumentTotals(computed);
  }, [canEdit, lines, taxes]);

  const activityEntries: TimelineEntry[] = (activity ?? []).map((entry) => ({
    id: entry.id,
    title: entry.description,
    timestamp: formatDateTime(entry.createdAt),
    status: entry.type.includes("CANCEL")
      ? "rejected"
      : entry.type.includes("CONFIRM") || entry.type.includes("POST")
        ? "done"
        : "pending",
  }));

  if (props.isLoading) {
    return (
      <div className="p-8 text-caption text-muted-foreground" role="status">
        {t("common.loading")}
      </div>
    );
  }

  return (
    <EnterpriseCard size="sm" className="pb-20 md:pb-0">
      <EnterpriseCardContent className="flex flex-col gap-3">
        <EditorHeader
          title={props.title}
          documentNumber={props.documentNumber ?? `${props.docCodePreview ?? ""}-…`}
          status={
            statusOption ? (
              <StatusBadge label={statusOption.label} tone={statusOption.tone} />
            ) : null
          }
          actions={
            <DocumentActionBar
              status={status}
              actions={props.actions}
              context={props.actionContext}
              leading={props.toolbarExtra}
              isBusy={props.isBusy}
              isNew={!props.documentNumber}
            />
          }
        />

        {props.trace?.id ? (
          <RelatedRecordsPanel kind={props.trace.kind} id={props.trace.id} refreshKey={status} />
        ) : null}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="flex min-w-0 flex-col gap-1 sm:col-span-2 lg:col-span-1">
            <label className="text-caption text-muted-foreground">{t(props.party.labelKey)}</label>
            <PartnerPicker
              role={props.party.role}
              value={props.party.value}
              onChange={props.party.onChange}
              disabled={!canEdit}
            />
          </div>
          <div className="flex min-w-0 flex-col gap-1">
            <label className="text-caption text-muted-foreground">
              {t("sales.editor.header.documentDate")}
            </label>
            <EnterpriseDatePicker
              value={props.documentDate}
              onChange={props.onDocumentDateChange}
              disabled={!canEdit}
            />
          </div>
          <div className="flex min-w-0 flex-col gap-1">
            <label className="text-caption text-muted-foreground">
              {t("sales.editor.header.currency")}
            </label>
            <Select
              value={props.currency?.id ?? "__base__"}
              disabled={!canEdit}
              onValueChange={(value) =>
                props.onCurrencyChange(
                  value === "__base__"
                    ? null
                    : (currencies.find((currency) => currency.id === value) ?? null),
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
          <div className="flex min-w-0 flex-col gap-1">
            <label className="text-caption text-muted-foreground">
              {t("sales.editor.sections.referenceNumber")}
            </label>
            <Input
              inputSize="sm"
              value={props.referenceNumber}
              disabled={!canEdit}
              onChange={(event) => props.onReferenceNumberChange(event.target.value)}
            />
          </div>
          {props.headerFields}
        </div>

        <div className="flex min-w-0 flex-col gap-2">
          <h2 className="text-card-title font-heading">
            {t("sales.editor.sections.productLines")}
          </h2>
          <ProductLineItemsGrid
            lines={lines}
            onChange={props.onLinesChange}
            requireWarehouse={props.requireWarehouse}
            disabled={!canEdit}
            sellableOnly={props.lineMode === "sales"}
            purchasableOnly={props.lineMode === "purchase"}
            enableLineTreatment={props.enableLineTreatment}
          />
        </div>

        <DocumentTotalsFooter
          totals={previewTotals ?? serverTotals}
          isLoading={!previewTotals && props.isTotalsLoading}
          currency={props.currency?.code}
        />
        {props.currency ? (
          <p className="text-end text-caption text-muted-foreground">
            {t("sales.editor.header.currencyNote", { code: props.currency.code })}
          </p>
        ) : null}
        {props.paymentSummary}

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div className="flex flex-col gap-1">
            <label className="text-caption text-muted-foreground">
              {t("sales.editor.sections.terms")}
            </label>
            <Textarea
              value={props.terms}
              disabled={!canEdit}
              onChange={(event) => props.onTermsChange(event.target.value)}
              rows={2}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-caption text-muted-foreground">
              {t("sales.editor.sections.notes")}
            </label>
            <Textarea
              value={props.notes}
              disabled={!canEdit}
              onChange={(event) => props.onNotesChange(event.target.value)}
              rows={2}
            />
          </div>
        </div>

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
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="flex flex-col gap-1">
                <span className="text-caption text-muted-foreground">
                  {t("sales.editor.header.company")}
                </span>
                <p className="text-sm font-medium">{activeCompany?.name ?? "—"}</p>
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-caption text-muted-foreground">
                  {t("sales.editor.header.branch")}
                </span>
                <p className="text-sm font-medium">{activeBranch?.name ?? "—"}</p>
              </div>
            </div>
            {props.moreDetails}
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
