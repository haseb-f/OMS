"use client";

import { Fragment, useEffect, useId, useMemo, useRef, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { EnterpriseCard, EnterpriseCardContent } from "@/components/ui/card";
import { EnterpriseButton } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { CurrencyPicker } from "@/components/business/currency-picker";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { EnterpriseDatePicker } from "@/components/shared/date-picker";
import { EditorHeader } from "@/components/shared/detail-workspace";
import {
  FormErrorSummary,
  useFocusFirstInvalid,
  type FormErrorItem,
} from "@/components/shared/form-error-summary";
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
import { useNavigationDraft } from "@/hooks/use-navigation-draft";
import { useCompany } from "@/providers/company-provider";
import { useLocale } from "@/providers/locale-provider";
import { formatDate, formatDateTime } from "@/lib/date";
import type { MessageKey } from "@/i18n/translate";
import type { PartnerRoleValue, PartnerPickerRow } from "@/services/partners-service";
import type { CurrencyRow } from "@/config/master-data/entities";
import type { TraceKind } from "@/services/traceability-service";
import { FieldMessage } from "@/components/ui/form";
import { useUiPilot } from "@/providers/ui-pilot-provider";
import { DocumentActionBar, type DocumentAction } from "./document-action-bar";
import {
  DocumentEditorPilotLayout,
  pilotFieldClass,
  pilotFieldGridClass,
} from "./pilot/document-editor-pilot-layout";

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

/** Inline validation messages, keyed by the field they belong under. */
export interface CommercialDocumentFieldErrors {
  party?: string | null;
  documentDate?: string | null;
  lines?: string | null;
  /** Anything not tied to one field — shown above the action area, under the totals. */
  form?: string | null;
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
    value: PartnerPickerRow | null;
    onChange: (partner: PartnerPickerRow) => void;
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
  /**
   * Extra, independent status shown next to the workflow status in the
   * header (e.g. an invoice's payment status) — each badge names its state.
   */
  headerStatus?: ReactNode;
  /** Round 3.1 pilot: read-only workflow tracker(s) under the header (pilot layout only). */
  headerTracker?: ReactNode;
  /** Inline validation (never toast-only); entered data is never cleared. */
  fieldErrors?: CommercialDocumentFieldErrors;
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
  const currencyFieldId = useId();
  const partyFieldId = useId();
  const dateFieldId = useId();
  const referenceFieldId = useId();
  const termsFieldId = useId();
  const notesFieldId = useId();
  const bodyRef = useRef<HTMLDivElement>(null);
  const focusFirstInvalid = useFocusFirstInvalid(bodyRef);
  const { canEdit, lines, totals: serverTotals, status, statusOptions, activity } = props;
  // Round 3 pilot (design-system §12.6): same state and handlers, Geist page anatomy.
  const pilot = useUiPilot().active;

  // Unsaved edits survive "Open full record" from a related-record preview.
  useNavigationDraft({
    enabled: canEdit,
    ready: !props.isLoading,
    snapshot: () => ({
      party: props.party.value,
      documentDate: props.documentDate,
      currency: props.currency,
      referenceNumber: props.referenceNumber,
      notes: props.notes,
      terms: props.terms,
      lines,
    }),
    restore: (draft) => {
      if (draft.party) props.party.onChange(draft.party);
      props.onDocumentDateChange(draft.documentDate ? new Date(draft.documentDate) : null);
      props.onCurrencyChange(draft.currency);
      props.onReferenceNumberChange(draft.referenceNumber);
      props.onNotesChange(draft.notes);
      props.onTermsChange(draft.terms);
      props.onLinesChange(draft.lines);
    },
  });

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

  const errors = props.fieldErrors;
  const summaryItems = (
    [
      errors?.party
        ? { fieldId: "party", label: t(props.party.labelKey), message: errors.party }
        : null,
      errors?.documentDate
        ? {
            fieldId: "documentDate",
            label: t("sales.editor.header.documentDate"),
            message: errors.documentDate,
          }
        : null,
      errors?.lines
        ? {
            fieldId: "lines",
            label: t("sales.editor.sections.productLines"),
            message: errors.lines,
          }
        : null,
      errors?.form ? { message: errors.form } : null,
    ] as (FormErrorItem | null)[]
  ).filter((item): item is FormErrorItem => item !== null);

  // Focus moves ONCE to the first invalid field when a failed save surfaces
  // new problems — never on every keystroke while the user fixes them.
  const errorSignature = summaryItems.map((item) => item.fieldId ?? item.message).join("|");
  const lastSignature = useRef("");
  useEffect(() => {
    if (errorSignature && errorSignature !== lastSignature.current) focusFirstInvalid();
    lastSignature.current = errorSignature;
  }, [errorSignature, focusFirstInvalid]);

  if (props.isLoading) {
    return (
      <div className="p-8 text-caption text-muted-foreground" role="status">
        {t("common.loading")}
      </div>
    );
  }

  // Key meta: party · date · currency — each part isolated so an LTR date
  // or code never reorders inside the Arabic line.
  const metaParts = [
    props.party.value?.name,
    props.documentDate ? formatDate(props.documentDate) : null,
    props.currency?.code,
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
  const hasNotes = Boolean(props.notes.trim() || props.terms.trim());

  const statusNode =
    statusOption || props.headerStatus ? (
      <span className="flex flex-wrap items-center gap-2">
        {statusOption ? <StatusBadge label={statusOption.label} tone={statusOption.tone} /> : null}
        {props.headerStatus ? (
          // Payment is an independent lifecycle — its own group, never merged with the workflow status.
          <span className="flex items-center gap-1.5 border-s border-border ps-2">
            {props.headerStatus}
          </span>
        ) : null}
      </span>
    ) : null;

  const actionBar = (
    <DocumentActionBar
      status={status}
      actions={props.actions}
      context={props.actionContext}
      leading={props.toolbarExtra}
      isBusy={props.isBusy}
      isNew={!props.documentNumber}
    />
  );

  const errorSummary = <FormErrorSummary errors={summaryItems} className="mb-0" />;

  const partyField = (
    <>
      <label htmlFor={partyFieldId} className="text-caption text-muted-foreground">
        {t(props.party.labelKey)}
      </label>
      <PartnerPicker
        id={partyFieldId}
        role={props.party.role}
        value={props.party.value}
        onChange={props.party.onChange}
        disabled={!canEdit}
        error={Boolean(errors?.party)}
        aria-describedby={errors?.party ? `${partyFieldId}-error` : undefined}
      />
      {/* The summary already announces — no second live region here. */}
      <FieldMessage id={`${partyFieldId}-error`} announce={false} data-testid="field-error-party">
        {errors?.party}
      </FieldMessage>
    </>
  );
  const dateField = (
    <>
      <label htmlFor={dateFieldId} className="text-caption text-muted-foreground">
        {t("sales.editor.header.documentDate")}
      </label>
      <EnterpriseDatePicker
        id={dateFieldId}
        value={props.documentDate}
        onChange={props.onDocumentDateChange}
        disabled={!canEdit}
        aria-invalid={Boolean(errors?.documentDate) || undefined}
      />
      <FieldMessage>{errors?.documentDate}</FieldMessage>
    </>
  );
  const currencyField = (
    <>
      <label htmlFor={currencyFieldId} className="text-caption text-muted-foreground">
        {t("sales.editor.header.currency")}
      </label>
      {/* Empty = base currency (null), as the old "__base__" row was. */}
      <CurrencyPicker
        id={currencyFieldId}
        valueKey="id"
        value={props.currency?.id ?? ""}
        disabled={!canEdit}
        onValueChange={(value) =>
          props.onCurrencyChange(currencies.find((currency) => currency.id === value) ?? null)
        }
        allowClear
        placeholder={t("sales.editor.header.baseCurrency")}
      />
    </>
  );
  const referenceField = (
    <>
      <label htmlFor={referenceFieldId} className="text-caption text-muted-foreground">
        {t("sales.editor.sections.referenceNumber")}
      </label>
      <Input
        id={referenceFieldId}
        dir="auto"
        value={props.referenceNumber}
        disabled={!canEdit}
        onChange={(event) => props.onReferenceNumberChange(event.target.value)}
      />
    </>
  );

  const linesGrid = (
    <>
      <ProductLineItemsGrid
        title={t("sales.editor.sections.productLines")}
        lines={lines}
        onChange={props.onLinesChange}
        requireWarehouse={props.requireWarehouse}
        disabled={!canEdit}
        sellableOnly={props.lineMode === "sales"}
        purchasableOnly={props.lineMode === "purchase"}
        enableLineTreatment={props.enableLineTreatment}
        showErrors={Boolean(errors?.lines)}
      />
      <FieldMessage data-testid="field-error-lines">{errors?.lines}</FieldMessage>
    </>
  );

  const details = (
    <>
      <Collapsible defaultOpen={hasNotes}>
        <CollapsibleTrigger asChild>
          <EnterpriseButton
            type="button"
            variant="ghost"
            size="sm"
            className="group w-fit gap-1.5 px-1.5 text-muted-foreground"
          >
            <ChevronDown className="size-3.5 transition-transform group-data-[state=open]:rotate-180" />
            {t("sales.editor.sections.notesAndTerms")}
          </EnterpriseButton>
        </CollapsibleTrigger>
        <CollapsibleContent className="grid grid-cols-1 gap-3 pt-2 md:grid-cols-2">
          <div className="flex flex-col gap-1">
            <label htmlFor={termsFieldId} className="text-caption text-muted-foreground">
              {t("sales.editor.sections.terms")}
            </label>
            <Textarea
              id={termsFieldId}
              value={props.terms}
              disabled={!canEdit}
              onChange={(event) => props.onTermsChange(event.target.value)}
              rows={2}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor={notesFieldId} className="text-caption text-muted-foreground">
              {t("sales.editor.sections.notes")}
            </label>
            <Textarea
              id={notesFieldId}
              value={props.notes}
              disabled={!canEdit}
              onChange={(event) => props.onNotesChange(event.target.value)}
              rows={2}
            />
          </div>
        </CollapsibleContent>
      </Collapsible>

      <Collapsible>
        <CollapsibleTrigger asChild>
          <EnterpriseButton
            type="button"
            variant="ghost"
            size="sm"
            className="group w-fit gap-1.5 px-1.5 text-muted-foreground"
          >
            <ChevronDown className="size-3.5 transition-transform group-data-[state=open]:rotate-180" />
            {t("sales.editor.sections.moreDetails")}
          </EnterpriseButton>
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-2 flex flex-col gap-3 border-t border-border pt-3">
          <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <div className="flex flex-col gap-1">
              <dt className="text-caption text-muted-foreground">
                {t("sales.editor.header.company")}
              </dt>
              <dd className="text-body font-medium">{activeCompany?.name ?? "—"}</dd>
            </div>
            <div className="flex flex-col gap-1">
              <dt className="text-caption text-muted-foreground">
                {t("sales.editor.header.branch")}
              </dt>
              <dd className="text-body font-medium">{activeBranch?.name ?? "—"}</dd>
            </div>
          </dl>
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
    </>
  );

  const totalsBlock = (
    <>
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
    </>
  );

  const formError = <FieldMessage data-testid="field-error-form">{errors?.form}</FieldMessage>;

  if (pilot) {
    return (
      <DocumentEditorPilotLayout
        bodyRef={bodyRef}
        title={props.title}
        documentNumber={props.documentNumber}
        pendingNumberLabel={t("sales.editor.header.numberOnSave")}
        status={statusNode}
        meta={meta}
        tracker={props.headerTracker}
        actions={actionBar}
        errorSummary={errorSummary}
        fields={
          <div className={pilotFieldGridClass}>
            <div
              data-field-name="party"
              data-invalid={errors?.party ? "true" : undefined}
              className={pilotFieldClass.wide}
            >
              {partyField}
            </div>
            <div
              data-field-name="documentDate"
              data-invalid={errors?.documentDate ? "true" : undefined}
              className={pilotFieldClass.narrow}
            >
              {dateField}
            </div>
            <div className={pilotFieldClass.narrow}>{currencyField}</div>
            <div className={pilotFieldClass.wide}>{referenceField}</div>
            {props.headerFields}
          </div>
        }
        lines={
          <div
            data-field-name="lines"
            data-invalid={errors?.lines ? "true" : undefined}
            className="flex min-w-0 flex-col gap-1"
          >
            {linesGrid}
          </div>
        }
        details={details}
        totals={totalsBlock}
        formError={formError}
        related={
          props.trace?.id ? (
            <RelatedRecordsPanel
              kind={props.trace.kind}
              id={props.trace.id}
              refreshKey={status}
              className="bg-card"
            />
          ) : null
        }
      />
    );
  }

  return (
    <EnterpriseCard size="sm" className="overflow-visible pb-20 md:pb-(--card-spacing)">
      <EnterpriseCardContent ref={bodyRef} data-form-scope="" className="flex flex-col gap-3">
        <EditorHeader
          sticky
          title={props.title}
          documentNumber={
            // EditorHeader puts the number in a dir="ltr" span; this keeps the gap on the title side in RTL.
            <span>{props.documentNumber ?? `${props.docCodePreview ?? ""}-…`}</span>
          }
          meta={meta}
          status={statusNode}
          actions={actionBar}
        />

        {errorSummary}

        {/* Compact header fields: the party takes the room it needs; date,
            currency and reference keep their natural widths on sm+. */}
        <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
          <div
            data-field-name="party"
            data-invalid={errors?.party ? "true" : undefined}
            className="flex w-full min-w-0 flex-col gap-1 sm:w-80 sm:max-w-full lg:w-96"
          >
            {partyField}
          </div>
          <div
            data-field-name="documentDate"
            data-invalid={errors?.documentDate ? "true" : undefined}
            className="flex w-[calc(50%-0.375rem)] min-w-0 flex-col gap-1 sm:w-44"
          >
            {dateField}
          </div>
          <div className="flex w-[calc(50%-0.375rem)] min-w-0 flex-col gap-1 sm:w-40">
            {currencyField}
          </div>
          <div className="flex w-full min-w-0 flex-col gap-1 sm:w-48">{referenceField}</div>
          {props.headerFields}
        </div>

        <div
          data-field-name="lines"
          data-invalid={errors?.lines ? "true" : undefined}
          className="flex min-w-0 flex-col gap-1 border-t border-border pt-3"
        >
          {linesGrid}
        </div>

        {/* Notes/terms (start) beside a right-sized totals block (end, on the numeric edge). */}
        <div className="grid grid-cols-1 items-start gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,24rem)]">
          <div className="order-2 flex min-w-0 flex-col gap-1 lg:order-1">{details}</div>
          <div className="order-1 flex min-w-0 flex-col gap-2 lg:order-2">{totalsBlock}</div>
        </div>
        {formError}

        {/* Related records are secondary context — after the document body, not above the fields. */}
        {props.trace?.id ? (
          <RelatedRecordsPanel kind={props.trace.kind} id={props.trace.id} refreshKey={status} />
        ) : null}
      </EnterpriseCardContent>
    </EnterpriseCard>
  );
}
