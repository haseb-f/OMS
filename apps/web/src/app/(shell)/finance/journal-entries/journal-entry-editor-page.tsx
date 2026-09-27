"use client";

import { RelatedRecordsPanel } from "@/components/shared/related-records-panel";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Archive,
  ChevronDown,
  Copy,
  FileStack,
  Printer,
  RotateCcw,
  Save,
  Send,
  Trash2,
  Undo2,
} from "lucide-react";
import { EnterpriseButton } from "@/components/ui/button";
import { EnterpriseCard, EnterpriseCardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { EnterpriseDatePicker } from "@/components/shared/date-picker";
import { SearchableSelect } from "@/components/shared/searchable-select";
import { CurrencyPicker } from "@/components/business/currency-picker";
import { cachedLookup } from "@/lib/lookup-cache";
import { DocumentActionBar, type DocumentAction } from "@/components/documents/document-action-bar";
import { FieldMessage } from "@/components/ui/form";
import { EditorHeader, EditorWorkspace } from "@/components/shared/detail-workspace";
import { FormErrorSummary, useFocusFirstInvalid } from "@/components/shared/form-error-summary";
import { EnterpriseModal } from "@/components/shared/enterprise-modal";
import { StatusBadge } from "@/components/business/status-badge";
import { AuditTimeline, type TimelineEntry } from "@/components/business/timeline";
import {
  JournalEntryLinesGrid,
  type JournalEntryLineGridRow,
} from "@/components/accounting/journal-entry-lines-grid";
import {
  journalEntriesService,
  type JournalEntryActivityEntry,
  type JournalEntryRow,
  type JournalEntryTemplateRow,
} from "@/services/journal-entries-service";
import { createMasterDataService } from "@/services/master-data-service";
import type {
  ChartOfAccountRow,
  JournalRow,
  CostCenterRow,
  ProjectRow,
} from "@/config/master-data/entities";
import {
  JOURNAL_ENTRY_STATUS_LABEL_KEY,
  JOURNAL_ENTRY_STATUS_TONE,
} from "@/config/accounting/status";
import { buildJournalEntryPrintPayload } from "@/config/accounting/journal-entry-print";
import { usePrintEngine } from "@/hooks/use-print-engine";
import { useCompany } from "@/providers/company-provider";
import { useUserContext } from "@/providers/user-context";
import { useLocale } from "@/providers/locale-provider";
import { useBreadcrumbLabel } from "@/providers/breadcrumb-provider";
import { useCurrencies } from "@/hooks/use-reference-data";
import { formatDate, formatDateTime } from "@/lib/date";
import { reportApiError, toast, reportSuccess } from "@/lib/toast";
import { ApiError } from "@/services/api-client";
import {
  isGeneratedJournalSource,
  isManualJournalSource,
} from "@/config/accounting/journal-source";

const accountsService = createMasterDataService<ChartOfAccountRow>("/chart-of-accounts");

/** The entry's own `currency` include is a slim `{id,code,name}` projection (see ENTRY_INCLUDE server-side), not a full CurrencyRow — the selector only ever needs these three fields. */
type CurrencyOption = { id: string; code: string; name: string };

/** Accounting Foundation (TASK-044 Part 6) — bespoke editor. */
const journalsService = createMasterDataService<JournalRow>("/journals");
const costCentersService = createMasterDataService<CostCenterRow>("/cost-centers");
const projectsService = createMasterDataService<ProjectRow>("/projects");

function lineToGridRow(line: JournalEntryRow["lines"][number]): JournalEntryLineGridRow {
  return {
    id: line.id,
    accountId: line.accountId,
    account: line.account ?? null,
    description: line.description ?? "",
    costCenterId: line.costCenterId ?? "",
    projectId: line.projectId ?? "",
    partnerId: line.partnerId ?? "",
    partner: line.partner ?? null,
    debit: Number(line.debit),
    credit: Number(line.credit),
  };
}

/** "Recurring Journal Templates" — a saved template's lines have no ids yet (JSON payload), so applying one always mints fresh grid row ids. */
function templateLineToGridRow(
  line: JournalEntryTemplateRow["lines"][number],
  index: number,
): JournalEntryLineGridRow {
  return {
    id: `tpl-${Date.now()}-${index}`,
    accountId: line.accountId,
    description: line.description ?? "",
    costCenterId: line.costCenterId ?? "",
    projectId: line.projectId ?? "",
    partnerId: "",
    partner: null,
    debit: line.debit ?? 0,
    credit: line.credit ?? 0,
  };
}

/** Accounting Foundation (TASK-044 Part 6) — bespoke editor (not a generic framework fork): the body is a debit/credit line grid, genuinely different from every other document editor's product-line or allocation shape. */
export function JournalEntryEditorPage({ id }: { id: string | null }) {
  const router = useRouter();
  const { t } = useLocale();
  const { printDocument } = usePrintEngine();
  const { activeCompany } = useCompany();
  const { user, hasPermission } = useUserContext();

  const [entry, setEntry] = useState<JournalEntryRow | null>(null);
  const [isLoading, setIsLoading] = useState(!!id);
  const [isSaving, setIsSaving] = useState(false);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [activity, setActivity] = useState<JournalEntryActivityEntry[] | null | undefined>(
    undefined,
  );
  const [accounts, setAccounts] = useState<ChartOfAccountRow[]>([]);
  const [journals, setJournals] = useState<JournalRow[]>([]);
  const [costCenters, setCostCenters] = useState<CostCenterRow[]>([]);
  const [projects, setProjects] = useState<ProjectRow[]>([]);

  const [entryDate, setEntryDate] = useState<Date | null>(new Date());
  const [description, setDescription] = useState("");
  const [journalId, setJournalId] = useState("");
  const [referenceNumber, setReferenceNumber] = useState("");
  const [lines, setLines] = useState<JournalEntryLineGridRow[]>([]);
  const currencies = useCurrencies();
  const [currency, setCurrency] = useState<CurrencyOption | null>(null);
  const fieldId = useId();

  const [templates, setTemplates] = useState<JournalEntryTemplateRow[]>([]);
  const [saveTemplateOpen, setSaveTemplateOpen] = useState(false);
  const [templateName, setTemplateName] = useState("");
  const [templateDescription, setTemplateDescription] = useState("");
  const [isSavingTemplate, setIsSavingTemplate] = useState(false);

  const [isDuplicating, setIsDuplicating] = useState(false);
  /** Inline (not toast-only) validation, shown under the lines; entered data is never cleared. */
  const [validationError, setValidationError] = useState<string | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const focusFirstInvalid = useFocusFirstInvalid(bodyRef);

  const applyEntry = useCallback((data: JournalEntryRow) => {
    setEntry(data);
    setEntryDate(new Date(data.entryDate));
    setDescription(data.description ?? "");
    setJournalId(data.journalId ?? "");
    setReferenceNumber(data.referenceNumber ?? "");
    setLines(data.lines.map(lineToGridRow));
    setCurrency(data.currency ?? null);
  }, []);

  useEffect(() => {
    // Reference lists are deduped through `cachedLookup`, so reopening the
    // editor within the TTL reuses them. The accounts page is only a display
    // map for existing/template lines — the line grid's account picker
    // searches the whole chart remotely. `accounts:` prefix = invalidated on
    // chart-of-accounts changes.
    const accountParams = { pageSize: 200, postingOnly: true };
    cachedLookup(`accounts:prefetch:${JSON.stringify(accountParams)}`, () =>
      accountsService.list(accountParams),
    )
      .then((result) => setAccounts(result.items))
      .catch(() => setAccounts([]));
    cachedLookup("journals:prefetch:200", () => journalsService.list({ pageSize: 200 }))
      .then((result) => setJournals(result.items))
      .catch(() => setJournals([]));
    cachedLookup("cost-centers:prefetch:200", () => costCentersService.list({ pageSize: 200 }))
      .then((result) => setCostCenters(result.items))
      .catch(() => setCostCenters([]));
    cachedLookup("projects:prefetch:200", () => projectsService.list({ pageSize: 200 }))
      .then((result) => setProjects(result.items))
      .catch(() => setProjects([]));
    journalEntriesService.templates
      .list()
      .then(setTemplates)
      .catch(() => setTemplates([]));
  }, []);

  useEffect(() => {
    if (!id) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setIsLoading(false);
      setActivity([]);
      return;
    }
    const load = async () => {
      setIsLoading(true);
      try {
        applyEntry(await journalEntriesService.get(id));
      } catch (error) {
        reportApiError(error, "errors.loadFailed");
      } finally {
        setIsLoading(false);
      }
    };
    void load();
  }, [id, applyEntry]);

  const refreshActivity = useCallback((entryId: string) => {
    journalEntriesService
      .activities(entryId)
      .then(setActivity)
      .catch(() => setActivity([]));
  }, []);

  useEffect(() => {
    if (id) refreshActivity(id);
  }, [id, refreshActivity]);

  const totalDebit = lines.reduce((sum, l) => sum + l.debit, 0);
  const totalCredit = lines.reduce((sum, l) => sum + l.credit, 0);

  const validate = (): string | null => {
    if (lines.length < 2) return t("accounting.journalEntries.validation.minLines");
    if (lines.some((l) => !l.accountId))
      return t("accounting.journalEntries.validation.accountRequired");
    if (Math.abs(totalDebit - totalCredit) > 0.001)
      return t("accounting.journalEntries.validation.unbalanced");
    return null;
  };

  const buildPayload = () => ({
    entryDate: entryDate ? entryDate.toISOString() : undefined,
    description: description || undefined,
    journalId: journalId || undefined,
    referenceNumber: referenceNumber || undefined,
    currencyId: currency?.id || undefined,
    lines: lines.map((line) => ({
      accountId: line.accountId,
      description: line.description || undefined,
      costCenterId: line.costCenterId || undefined,
      projectId: line.projectId || undefined,
      partnerId: line.partnerId || undefined,
      debit: line.debit || undefined,
      credit: line.credit || undefined,
    })),
  });

  const handleSave = async () => {
    const error = validate();
    setValidationError(error);
    if (error) {
      focusFirstInvalid();
      return;
    }
    setIsSaving(true);
    try {
      if (id) {
        const updated = await journalEntriesService.update(id, buildPayload());
        applyEntry(updated);
        reportSuccess(t("common.saved"));
      } else {
        const created = await journalEntriesService.create(buildPayload());
        reportSuccess(t("common.saved"));
        router.replace(`/finance/journal-entries/${created.id}`);
      }
    } catch (error) {
      reportApiError(error, "errors.generic");
    } finally {
      setIsSaving(false);
    }
  };

  const runTransition = async (
    action: (entryId: string) => Promise<JournalEntryRow>,
    successKey: Parameters<typeof t>[0],
  ) => {
    if (!id) return;
    setIsTransitioning(true);
    try {
      const updated = await action(id);
      applyEntry(updated);
      reportSuccess(t(successKey));
      refreshActivity(id);
    } catch (error) {
      reportApiError(error, "errors.generic");
    } finally {
      setIsTransitioning(false);
    }
  };

  const handlePrint = () => {
    if (!entry) return;
    printDocument(
      buildJournalEntryPrintPayload(entry, {
        companyName: activeCompany?.name ?? "",
        companyLogoUrl: activeCompany?.logoUrl ?? null,
        printedByName: user?.fullName ?? null,
        t,
      }),
    );
  };

  /** Hard delete — Draft only, server-enforced. Unlike Archive (which only hides it), this removes the entry entirely; once Posted, use Archive/Reverse instead — permanent ledger history is never truly deleted. */
  const handleDelete = async () => {
    if (!id) return;
    setIsTransitioning(true);
    try {
      await journalEntriesService.remove(id);
      reportSuccess(t("accounting.journalEntries.toasts.deleted"));
      router.push("/finance/journal-entries");
    } catch (error) {
      reportApiError(error, "errors.generic");
    } finally {
      setIsTransitioning(false);
    }
  };

  const handleDuplicate = async () => {
    if (!id) return;
    setIsDuplicating(true);
    try {
      const duplicated = await journalEntriesService.duplicate(id);
      reportSuccess(t("accounting.journalEntries.toasts.duplicated"));
      router.push(`/finance/journal-entries/${duplicated.id}`);
    } catch (error) {
      reportApiError(error, "errors.generic");
    } finally {
      setIsDuplicating(false);
    }
  };

  /** "Recurring Journal Templates" — only offered on the "new" route; applying pre-fills Journal + Lines, never the entry's own Description/Reference. */
  const handleApplyTemplate = (templateId: string) => {
    const template = templates.find((t) => t.id === templateId);
    if (!template) return;
    setJournalId(template.journalId ?? "");
    setLines(template.lines.map(templateLineToGridRow));
    reportSuccess(t("accounting.journalEntries.templates.applied"));
  };

  const handleSaveTemplate = async () => {
    if (!templateName.trim()) return;
    setIsSavingTemplate(true);
    try {
      const saved = await journalEntriesService.templates.save({
        name: templateName.trim(),
        description: templateDescription.trim() || undefined,
        journalId: journalId || undefined,
        lines: lines.map((line) => ({
          accountId: line.accountId,
          description: line.description || undefined,
          costCenterId: line.costCenterId || undefined,
          projectId: line.projectId || undefined,
          debit: line.debit || undefined,
          credit: line.credit || undefined,
        })),
      });
      setTemplates((previous) =>
        [...previous.filter((t) => t.id !== saved.id), saved].sort((a, b) =>
          a.name.localeCompare(b.name),
        ),
      );
      reportSuccess(t("accounting.journalEntries.templates.saved"));
      setSaveTemplateOpen(false);
      setTemplateName("");
      setTemplateDescription("");
    } catch (error) {
      reportApiError(error, "errors.generic");
    } finally {
      setIsSavingTemplate(false);
    }
  };

  const isGenerated = isGeneratedJournalSource(entry?.sourceType);
  const isManual = isManualJournalSource(entry?.sourceType);
  const canEdit = (!entry || entry.status === "DRAFT") && !isGenerated;
  const canPost = hasPermission("accounting.journal-entries.post");
  const canReverse = hasPermission("accounting.journal-entries.reverse") && isManual;
  const canResetToDraft = hasPermission("accounting.journal-entries.post") && isManual;
  const canArchive = hasPermission("accounting.journal-entries.archive");
  const canDelete = hasPermission("accounting.journal-entries.archive");

  const activityEntries: TimelineEntry[] = (activity ?? []).map((a) => ({
    id: a.id,
    title: a.description,
    timestamp: formatDateTime(a.createdAt),
    status: a.type.includes("REVERSED")
      ? "rejected"
      : a.type.includes("POSTED")
        ? "done"
        : "pending",
  }));

  const statusOption = entry
    ? {
        label: t(JOURNAL_ENTRY_STATUS_LABEL_KEY[entry.status]),
        tone: JOURNAL_ENTRY_STATUS_TONE[entry.status],
      }
    : null;

  const journalOptions = useMemo(
    () =>
      journals.map((journal) => ({
        value: journal.id,
        label: `${journal.code} — ${journal.name}`,
      })),
    [journals],
  );

  const isNewEntry = !id;

  useBreadcrumbLabel(entry?.entryNumber ?? t("accounting.journalEntries.addNew"));

  /** One primary (Post) + everything else in the action bar's "More" menu, with confirmations inside the bar. */
  const journalActions: DocumentAction[] = [
    ...(canPost
      ? [
          {
            key: "post",
            label: t("accounting.journalEntries.actions.post"),
            icon: Send,
            primary: true,
            visibleForStatuses: ["DRAFT"],
            confirm: {
              title: t("accounting.journalEntries.confirmPostTitle"),
              description: t("accounting.journalEntries.confirmPostDescription"),
              confirmLabel: t("accounting.journalEntries.actions.post"),
            },
            onAction: () =>
              runTransition(
                (eid) => journalEntriesService.post(eid),
                "accounting.journalEntries.toasts.posted",
              ),
          } satisfies DocumentAction,
        ]
      : []),
    ...(canEdit && lines.length > 0
      ? [
          {
            key: "save-template",
            label: t("accounting.journalEntries.actions.saveAsTemplate"),
            icon: FileStack,
            onAction: () => setSaveTemplateOpen(true),
          } satisfies DocumentAction,
        ]
      : []),
    {
      key: "duplicate",
      label: t("accounting.journalEntries.actions.duplicate"),
      icon: Copy,
      onAction: handleDuplicate,
    },
    {
      key: "print",
      label: t("table.print"),
      icon: Printer,
      onAction: handlePrint,
    },
    ...(canResetToDraft
      ? [
          {
            key: "reset-to-draft",
            label: t("accounting.journalEntries.actions.resetToDraft"),
            icon: RotateCcw,
            visibleForStatuses: ["POSTED"],
            confirm: {
              title: t("accounting.journalEntries.confirmResetToDraftTitle"),
              description: t("accounting.journalEntries.confirmResetToDraftDescription"),
              confirmLabel: t("accounting.journalEntries.actions.resetToDraft"),
            },
            onAction: () =>
              runTransition(
                (eid) => journalEntriesService.resetToDraft(eid),
                "accounting.journalEntries.toasts.resetToDraft",
              ),
          } satisfies DocumentAction,
        ]
      : []),
    ...(canReverse
      ? [
          {
            key: "reverse",
            label: t("accounting.journalEntries.actions.reverse"),
            icon: Undo2,
            destructive: true,
            visibleForStatuses: ["POSTED"],
            confirm: {
              title: t("accounting.journalEntries.confirmReverseTitle"),
              description: t("accounting.journalEntries.confirmReverseDescription"),
              confirmLabel: t("accounting.journalEntries.actions.reverse"),
            },
            onAction: async () => {
              if (!id) return;
              const reversed = await journalEntriesService.reverse(id).catch((error) => {
                toast.error(error instanceof ApiError ? error.message : t("common.failedToSave"));
                return null;
              });
              if (reversed) {
                reportSuccess(t("accounting.journalEntries.toasts.reversed"));
                router.push(`/finance/journal-entries/${reversed.id}`);
              }
            },
          } satisfies DocumentAction,
        ]
      : []),
    ...(canArchive
      ? [
          {
            key: "archive",
            label: t("common.archive"),
            icon: Archive,
            destructive: true,
            visibleForStatuses: ["DRAFT"],
            confirm: {
              title: t("accounting.journalEntries.confirmArchiveTitle"),
              description: t("accounting.journalEntries.confirmArchiveDescription"),
              confirmLabel: t("common.archive"),
            },
            onAction: async () => {
              await runTransition(
                (eid) => journalEntriesService.archive(eid),
                "accounting.journalEntries.toasts.archived",
              );
              router.push("/finance/journal-entries");
            },
          } satisfies DocumentAction,
        ]
      : []),
    ...(canDelete
      ? [
          {
            key: "delete",
            label: t("common.delete"),
            icon: Trash2,
            destructive: true,
            visibleForStatuses: ["DRAFT"],
            confirm: {
              title: t("accounting.journalEntries.confirmDeleteTitle"),
              description: t("accounting.journalEntries.confirmDeleteDescription"),
              confirmLabel: t("common.delete"),
            },
            onAction: handleDelete,
          } satisfies DocumentAction,
        ]
      : []),
  ];

  return (
    <EditorWorkspace>
      <RelatedRecordsPanel kind="JOURNAL_ENTRY" id={id} refreshKey={entry?.status} />

      {isLoading ? (
        <div className="p-8 text-caption text-muted-foreground">{t("common.loading")}</div>
      ) : (
        <EnterpriseCard size="sm" className="overflow-visible pb-20 md:pb-(--card-spacing)">
          <EnterpriseCardContent ref={bodyRef} data-form-scope="" className="flex flex-col gap-3">
            <EditorHeader
              sticky
              title={t("accounting.journalEntries.editorTitle")}
              meta={
                entryDate || currency ? (
                  <>
                    {entryDate ? <bdi>{formatDate(entryDate)}</bdi> : null}
                    {entryDate && currency ? " · " : null}
                    {currency ? <bdi>{currency.code}</bdi> : null}
                  </>
                ) : undefined
              }
              documentNumber={<span>{entry?.entryNumber ?? "JV-…"}</span>}
              status={
                statusOption ? (
                  <StatusBadge label={statusOption.label} tone={statusOption.tone} />
                ) : null
              }
              actions={
                <>
                  {isNewEntry && templates.length > 0 && (
                    <Select value="" onValueChange={handleApplyTemplate}>
                      <SelectTrigger
                        size="sm"
                        aria-label={t("accounting.journalEntries.actions.newFromTemplate")}
                      >
                        <SelectValue
                          placeholder={t("accounting.journalEntries.actions.newFromTemplate")}
                        />
                      </SelectTrigger>
                      <SelectContent>
                        {templates.map((template) => (
                          <SelectItem key={template.id} value={template.id}>
                            {template.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                  <DocumentActionBar
                    status={entry?.status ?? "DRAFT"}
                    isNew={!entry}
                    actions={journalActions}
                    context={undefined}
                    isBusy={isSaving || isTransitioning || isDuplicating}
                    leading={
                      canEdit ? (
                        <EnterpriseButton
                          type="button"
                          size="sm"
                          variant={entry?.status === "DRAFT" && canPost ? "outline" : "default"}
                          className="gap-1.5"
                          disabled={isSaving || isTransitioning}
                          onClick={handleSave}
                        >
                          <Save className="size-3.5" />
                          {t("common.save")}
                        </EnterpriseButton>
                      ) : null
                    }
                  />
                </>
              }
            />

            <FormErrorSummary
              className="mb-0"
              errors={
                validationError
                  ? [
                      {
                        fieldId: "lines",
                        label: t("accounting.journalEntries.lines.title"),
                        message: validationError,
                      },
                    ]
                  : []
              }
            />

            {isGenerated ? (
              <p className="rounded-md border border-border bg-muted/30 px-3 py-2 text-caption text-muted-foreground">
                {t("accounting.journalEntries.systemGeneratedHint")}
              </p>
            ) : null}

            {/* Main form — compact grid */}
            <div className="grid grid-cols-1 gap-x-3 gap-y-2 sm:grid-cols-2 lg:grid-cols-4">
              <div className="flex min-w-0 flex-col gap-1">
                <label
                  htmlFor={`${fieldId}-journal`}
                  className="text-caption text-muted-foreground"
                >
                  {t("accounting.journalEntries.fields.journal")}
                </label>
                <SearchableSelect
                  id={`${fieldId}-journal`}
                  value={journalId}
                  onValueChange={setJournalId}
                  options={journalOptions}
                  placeholder={t("accounting.journalEntries.filters.journal")}
                  disabled={!canEdit}
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-caption text-muted-foreground">
                  {t("accounting.journalEntries.fields.entryDate")}
                </label>
                <EnterpriseDatePicker
                  value={entryDate}
                  onChange={setEntryDate}
                  disabled={!canEdit}
                />
              </div>
              <div className="flex flex-col gap-1">
                <label
                  htmlFor={`${fieldId}-reference`}
                  className="text-caption text-muted-foreground"
                >
                  {t("accounting.journalEntries.fields.referenceNumber")}
                </label>
                <Input
                  id={`${fieldId}-reference`}
                  dir="ltr"
                  value={referenceNumber}
                  disabled={!canEdit}
                  onChange={(event) => setReferenceNumber(event.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1">
                <label
                  htmlFor={`${fieldId}-currency`}
                  className="text-caption text-muted-foreground"
                >
                  {t("accounting.journalEntries.fields.currency")}
                </label>
                <CurrencyPicker
                  id={`${fieldId}-currency`}
                  valueKey="id"
                  value={currency?.id ?? null}
                  onValueChange={(next) =>
                    setCurrency(currencies.find((c) => c.id === next) ?? null)
                  }
                  disabled={!canEdit}
                />
              </div>
              <div className="flex flex-col gap-1 sm:col-span-2 lg:col-span-4">
                <label
                  htmlFor={`${fieldId}-description`}
                  className="text-caption text-muted-foreground"
                >
                  {t("accounting.journalEntries.fields.description")}
                </label>
                <Textarea
                  id={`${fieldId}-description`}
                  value={description}
                  disabled={!canEdit}
                  onChange={(event) => setDescription(event.target.value)}
                  rows={1}
                />
              </div>
            </div>

            {/* Lines — immediately below the main form, divided by a hairline */}
            <div
              data-field-name="lines"
              data-invalid={validationError ? "true" : undefined}
              className="flex min-w-0 flex-col gap-2 border-t border-border pt-3"
            >
              <h2 className="text-card-title font-heading">
                {t("accounting.journalEntries.lines.title")}
              </h2>
              <JournalEntryLinesGrid
                lines={lines}
                accounts={accounts}
                costCenters={costCenters}
                projects={projects}
                onChange={(next) => {
                  setLines(next);
                  if (validationError) setValidationError(null);
                }}
                disabled={!canEdit}
                currency={currency?.code}
              />
              {validationError ? (
                <FieldMessage data-testid="journal-validation-error">
                  {validationError}
                </FieldMessage>
              ) : null}
            </div>

            {entry && (
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
                <CollapsibleContent className="flex flex-col gap-3 border-t border-border pt-4">
                  {entry.reversalOfEntry && (
                    <p className="text-caption text-muted-foreground">
                      {t("accounting.journalEntries.fields.reversalOf")}:{" "}
                      <code dir="ltr">{entry.reversalOfEntry.entryNumber}</code>
                    </p>
                  )}
                  {entry.reversedByEntry && (
                    <p className="text-caption text-muted-foreground">
                      {t("accounting.journalEntries.status.reversed")}:{" "}
                      <code dir="ltr">{entry.reversedByEntry.entryNumber}</code>
                    </p>
                  )}
                  <div>
                    <p className="mb-1 text-caption font-medium text-muted-foreground">
                      {t("sales.editor.sections.attachments")}
                    </p>
                    <p className="text-caption text-muted-foreground">
                      {t("sales.editor.sections.attachmentsComingSoon")}
                    </p>
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
            )}
          </EnterpriseCardContent>
        </EnterpriseCard>
      )}

      <EnterpriseModal
        open={saveTemplateOpen}
        onOpenChange={setSaveTemplateOpen}
        size="md"
        icon={FileStack}
        title={t("accounting.journalEntries.templates.saveTitle")}
        description={t("accounting.journalEntries.templates.saveDescription")}
        isDirty={templateName.trim().length > 0}
        footer={(requestClose) => (
          <>
            <EnterpriseButton type="button" variant="outline" size="sm" onClick={requestClose}>
              {t("common.close")}
            </EnterpriseButton>
            <EnterpriseButton
              type="button"
              size="sm"
              disabled={!templateName.trim() || isSavingTemplate}
              onClick={handleSaveTemplate}
            >
              {t("common.save")}
            </EnterpriseButton>
          </>
        )}
      >
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-caption text-muted-foreground">
              {t("accounting.journalEntries.templates.nameLabel")}
            </label>
            <Input
              inputSize="sm"
              value={templateName}
              placeholder={t("accounting.journalEntries.templates.namePlaceholder")}
              onChange={(event) => setTemplateName(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-caption text-muted-foreground">
              {t("accounting.journalEntries.templates.descriptionLabel")}
            </label>
            <Textarea
              value={templateDescription}
              placeholder={t("accounting.journalEntries.templates.descriptionPlaceholder")}
              onChange={(event) => setTemplateDescription(event.target.value)}
              rows={2}
            />
          </div>
        </div>
      </EnterpriseModal>
    </EditorWorkspace>
  );
}
