"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, Copy, FileStack, Printer, Save, Send, Trash2, Undo2 } from "lucide-react";
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
import { ConfirmationDialog } from "@/components/shared/confirmation-dialog";
import { EditorHeader, EditorWorkspace } from "@/components/shared/detail-workspace";
import { EnterpriseModal } from "@/components/shared/enterprise-modal";
import { RelatedDocuments } from "@/components/shared/related-documents";
import { StatusBadge } from "@/components/business/status-badge";
import { AuditTimeline, type TimelineEntry } from "@/components/business/timeline";
import { CustomerPicker } from "@/components/business/customer-picker";
import { SupplierPicker } from "@/components/business/supplier-picker";
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
import { customersService, type CustomerRow } from "@/services/customers-service";
import { suppliersService, type SupplierRow } from "@/services/suppliers-service";
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
import { CreateOperationSummary } from "@/components/shared/create-operation";
import { MoneyValue } from "@/components/shared/money-value";
import { toast } from "@/lib/toast";
import { ApiError } from "@/services/api-client";

const accountsService = createMasterDataService<ChartOfAccountRow>("/chart-of-accounts");

type PartnerType = "none" | "customer" | "supplier";
/** The entry's own `currency` include is a slim `{id,code,name}` projection (see ENTRY_INCLUDE server-side), not a full CurrencyRow — the selector only ever needs these three fields. */
type CurrencyOption = { id: string; code: string; name: string };

/** TASK-054 (Related Documents Part 7) — "Journal ↔ Source Document": which editor route each auto-posting sourceType navigates back to. Manual entries and any future sourceType with no dedicated detail route are left unlinked, never a dead link. */
const SOURCE_DOCUMENT_ROUTE: Record<string, (id: string) => string> = {
  SALES_INVOICE: (id) => `/sales/invoices/${id}`,
  PURCHASE_INVOICE: (id) => `/purchasing/purchase-invoices/${id}`,
  SALES_RETURN: (id) => `/sales/returns/${id}`,
  PURCHASE_RETURN: (id) => `/purchasing/purchase-returns/${id}`,
  CUSTOMER_RECEIPT: (id) => `/sales/payments/${id}`,
  SUPPLIER_PAYMENT: (id) => `/purchasing/payments/${id}`,
};
const journalsService = createMasterDataService<JournalRow>("/journals");
const costCentersService = createMasterDataService<CostCenterRow>("/cost-centers");
const projectsService = createMasterDataService<ProjectRow>("/projects");

function lineToGridRow(line: JournalEntryRow["lines"][number]): JournalEntryLineGridRow {
  return {
    id: line.id,
    accountId: line.accountId,
    description: line.description ?? "",
    costCenterId: line.costCenterId ?? "",
    projectId: line.projectId ?? "",
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
  const [partnerType, setPartnerType] = useState<PartnerType>("none");
  const [partnerCustomer, setPartnerCustomer] = useState<CustomerRow | null>(null);
  const [partnerSupplier, setPartnerSupplier] = useState<SupplierRow | null>(null);

  const [templates, setTemplates] = useState<JournalEntryTemplateRow[]>([]);
  const [saveTemplateOpen, setSaveTemplateOpen] = useState(false);
  const [templateName, setTemplateName] = useState("");
  const [templateDescription, setTemplateDescription] = useState("");
  const [isSavingTemplate, setIsSavingTemplate] = useState(false);

  const [postTarget, setPostTarget] = useState(false);
  const [reverseTarget, setReverseTarget] = useState(false);
  const [archiveTarget, setArchiveTarget] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(false);
  const [isDuplicating, setIsDuplicating] = useState(false);

  const applyEntry = useCallback((data: JournalEntryRow) => {
    setEntry(data);
    setEntryDate(new Date(data.entryDate));
    setDescription(data.description ?? "");
    setJournalId(data.journalId ?? "");
    setReferenceNumber(data.referenceNumber ?? "");
    setLines(data.lines.map(lineToGridRow));
    setCurrency(data.currency ?? null);
    if (data.partnerCustomerId) {
      setPartnerType("customer");
      customersService
        .get(data.partnerCustomerId)
        .then(setPartnerCustomer)
        .catch(() => setPartnerCustomer(null));
    } else if (data.partnerSupplierId) {
      setPartnerType("supplier");
      suppliersService
        .get(data.partnerSupplierId)
        .then(setPartnerSupplier)
        .catch(() => setPartnerSupplier(null));
    } else {
      setPartnerType("none");
      setPartnerCustomer(null);
      setPartnerSupplier(null);
    }
  }, []);

  useEffect(() => {
    accountsService
      .list({ pageSize: 200, postingOnly: true })
      .then((result) => setAccounts(result.items))
      .catch(() => setAccounts([]));
    journalsService
      .list({ pageSize: 200 })
      .then((result) => setJournals(result.items))
      .catch(() => setJournals([]));
    costCentersService
      .list({ pageSize: 200 })
      .then((result) => setCostCenters(result.items))
      .catch(() => setCostCenters([]));
    projectsService
      .list({ pageSize: 200 })
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
        toast.error(error instanceof ApiError ? error.message : "Failed to load journal entry.");
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
    partnerCustomerId: partnerType === "customer" ? partnerCustomer?.id : undefined,
    partnerSupplierId: partnerType === "supplier" ? partnerSupplier?.id : undefined,
    lines: lines.map((line) => ({
      accountId: line.accountId,
      description: line.description || undefined,
      costCenterId: line.costCenterId || undefined,
      projectId: line.projectId || undefined,
      debit: line.debit || undefined,
      credit: line.credit || undefined,
    })),
  });

  const handleSave = async () => {
    const error = validate();
    if (error) {
      toast.error(error);
      return;
    }
    setIsSaving(true);
    try {
      if (id) {
        const updated = await journalEntriesService.update(id, buildPayload());
        applyEntry(updated);
        toast.success(t("common.save"));
      } else {
        const created = await journalEntriesService.create(buildPayload());
        toast.success(t("common.save"));
        router.replace(`/finance/journal-entries/${created.id}`);
      }
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Something went wrong.");
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
      toast.success(t(successKey));
      refreshActivity(id);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Something went wrong.");
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
      toast.success(t("accounting.journalEntries.toasts.deleted"));
      router.push("/finance/journal-entries");
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Something went wrong.");
    } finally {
      setIsTransitioning(false);
    }
  };

  const handleDuplicate = async () => {
    if (!id) return;
    setIsDuplicating(true);
    try {
      const duplicated = await journalEntriesService.duplicate(id);
      toast.success(t("accounting.journalEntries.toasts.duplicated"));
      router.push(`/finance/journal-entries/${duplicated.id}`);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Something went wrong.");
    } finally {
      setIsDuplicating(false);
    }
  };

  const handlePartnerTypeChange = (next: PartnerType) => {
    setPartnerType(next);
    if (next !== "customer") setPartnerCustomer(null);
    if (next !== "supplier") setPartnerSupplier(null);
  };

  /** "Recurring Journal Templates" — only offered on the "new" route; applying pre-fills Journal + Lines, never the entry's own Description/Reference. */
  const handleApplyTemplate = (templateId: string) => {
    const template = templates.find((t) => t.id === templateId);
    if (!template) return;
    setJournalId(template.journalId ?? "");
    setLines(template.lines.map(templateLineToGridRow));
    toast.success(t("accounting.journalEntries.templates.applied"));
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
      toast.success(t("accounting.journalEntries.templates.saved"));
      setSaveTemplateOpen(false);
      setTemplateName("");
      setTemplateDescription("");
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Something went wrong.");
    } finally {
      setIsSavingTemplate(false);
    }
  };

  const canEdit = !entry || entry.status === "DRAFT";
  const canPost = hasPermission("accounting.journal-entries.post");
  const canReverse = hasPermission("accounting.journal-entries.reverse");
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
      journals.map((journal) => ({ id: journal.id, label: `${journal.code} — ${journal.name}` })),
    [journals],
  );

  const isNewEntry = !id;

  useBreadcrumbLabel(entry?.entryNumber ?? t("accounting.journalEntries.addNew"));

  return (
    <EditorWorkspace>
      <RelatedDocuments
        groups={[
          {
            labelKey: "accounting.journalEntries.fields.sourceDocument",
            links:
              entry?.sourceType && entry.sourceId && SOURCE_DOCUMENT_ROUTE[entry.sourceType]
                ? [
                    {
                      id: entry.sourceId,
                      number: entry.referenceNumber ?? entry.sourceType,
                      href: SOURCE_DOCUMENT_ROUTE[entry.sourceType](entry.sourceId),
                    },
                  ]
                : [],
          },
        ]}
      />

      {isLoading ? (
        <div className="p-8 text-caption text-muted-foreground">{t("common.loading")}</div>
      ) : (
        <EnterpriseCard size="sm">
          <EnterpriseCardContent className="flex flex-col gap-3">
            <EditorHeader
              title={t("accounting.journalEntries.editorTitle")}
              documentNumber={entry?.entryNumber ?? "JV-…"}
              status={
                statusOption ? (
                  <StatusBadge label={statusOption.label} tone={statusOption.tone} />
                ) : null
              }
              actions={
                <>
                  {isNewEntry && templates.length > 0 && (
                    <Select value="" onValueChange={handleApplyTemplate}>
                      <SelectTrigger size="sm" className="w-auto min-w-[10rem]">
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
                  {canEdit && lines.length > 0 && (
                    <EnterpriseButton
                      type="button"
                      variant="outline"
                      size="sm"
                      className="gap-1.5"
                      onClick={() => setSaveTemplateOpen(true)}
                    >
                      <FileStack className="size-3.5" />
                      {t("accounting.journalEntries.actions.saveAsTemplate")}
                    </EnterpriseButton>
                  )}
                  {canEdit && (
                    <EnterpriseButton
                      type="button"
                      size="sm"
                      className="gap-1.5"
                      disabled={isSaving || isTransitioning}
                      onClick={handleSave}
                    >
                      <Save className="size-3.5" />
                      {t("common.save")}
                    </EnterpriseButton>
                  )}
                  {entry?.status === "DRAFT" && canPost && (
                    <EnterpriseButton
                      type="button"
                      variant="default"
                      size="sm"
                      className="gap-1.5"
                      disabled={isTransitioning}
                      onClick={() => setPostTarget(true)}
                    >
                      <Send className="size-3.5" />
                      {t("accounting.journalEntries.actions.post")}
                    </EnterpriseButton>
                  )}
                  {entry?.status === "POSTED" && canReverse && (
                    <EnterpriseButton
                      type="button"
                      variant="destructive"
                      size="sm"
                      className="gap-1.5"
                      disabled={isTransitioning}
                      onClick={() => setReverseTarget(true)}
                    >
                      <Undo2 className="size-3.5" />
                      {t("accounting.journalEntries.actions.reverse")}
                    </EnterpriseButton>
                  )}
                  {entry?.status === "DRAFT" && canArchive && (
                    <EnterpriseButton
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="gap-1.5"
                      disabled={isTransitioning}
                      onClick={() => setArchiveTarget(true)}
                    >
                      {t("common.archive")}
                    </EnterpriseButton>
                  )}
                  {entry?.status === "DRAFT" && canDelete && (
                    <EnterpriseButton
                      type="button"
                      variant="destructive"
                      size="sm"
                      className="gap-1.5"
                      disabled={isTransitioning}
                      onClick={() => setDeleteTarget(true)}
                    >
                      <Trash2 className="size-3.5" />
                      {t("common.delete")}
                    </EnterpriseButton>
                  )}
                  {entry && (
                    <EnterpriseButton
                      type="button"
                      variant="outline"
                      size="sm"
                      className="gap-1.5"
                      disabled={isDuplicating}
                      onClick={handleDuplicate}
                    >
                      <Copy className="size-3.5" />
                      {t("accounting.journalEntries.actions.duplicate")}
                    </EnterpriseButton>
                  )}
                  {entry && (
                    <EnterpriseButton
                      type="button"
                      variant="outline"
                      size="sm"
                      className="gap-1.5"
                      onClick={handlePrint}
                    >
                      <Printer className="size-3.5" />
                      {t("table.print")}
                    </EnterpriseButton>
                  )}
                </>
              }
            />

            {/* Main form — compact grid */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="flex flex-col gap-1">
                <label className="text-caption text-muted-foreground">
                  {t("accounting.journalEntries.fields.journal")}
                </label>
                <Select
                  value={journalId || undefined}
                  onValueChange={setJournalId}
                  disabled={!canEdit}
                >
                  <SelectTrigger size="sm" className="w-full">
                    <SelectValue placeholder={t("accounting.journalEntries.filters.journal")} />
                  </SelectTrigger>
                  <SelectContent>
                    {journalOptions.map((option) => (
                      <SelectItem key={option.id} value={option.id}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
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
                <label className="text-caption text-muted-foreground">
                  {t("accounting.journalEntries.fields.referenceNumber")}
                </label>
                <Input
                  inputSize="sm"
                  dir="ltr"
                  value={referenceNumber}
                  disabled={!canEdit}
                  onChange={(event) => setReferenceNumber(event.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-caption text-muted-foreground">
                  {t("accounting.journalEntries.fields.currency")}
                </label>
                <Select
                  value={currency?.id ?? undefined}
                  onValueChange={(next) =>
                    setCurrency(currencies.find((c) => c.id === next) ?? null)
                  }
                  disabled={!canEdit}
                >
                  <SelectTrigger size="sm" className="w-full">
                    <SelectValue placeholder={t("accounting.journalEntries.fields.currency")} />
                  </SelectTrigger>
                  <SelectContent>
                    {currencies.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.code} — {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-caption text-muted-foreground">
                  {t("accounting.journalEntries.fields.partnerType")}
                </label>
                <Select
                  value={partnerType}
                  onValueChange={(next) => handlePartnerTypeChange(next as PartnerType)}
                  disabled={!canEdit}
                >
                  <SelectTrigger size="sm" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">
                      {t("accounting.journalEntries.fields.noPartner")}
                    </SelectItem>
                    <SelectItem value="customer">
                      {t("accounting.journalEntries.fields.customer")}
                    </SelectItem>
                    <SelectItem value="supplier">
                      {t("accounting.journalEntries.fields.supplier")}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-caption text-muted-foreground">
                  {t("accounting.journalEntries.fields.partner")}
                </label>
                {partnerType === "customer" && (
                  <CustomerPicker
                    value={partnerCustomer}
                    onChange={setPartnerCustomer}
                    disabled={!canEdit}
                  />
                )}
                {partnerType === "supplier" && (
                  <SupplierPicker
                    value={partnerSupplier}
                    onChange={setPartnerSupplier}
                    disabled={!canEdit}
                  />
                )}
                {partnerType === "none" && (
                  <div className="flex h-9 items-center text-caption text-muted-foreground">
                    {t("accounting.journalEntries.fields.noPartner")}
                  </div>
                )}
              </div>
              <div className="flex flex-col gap-1 sm:col-span-3">
                <label className="text-caption text-muted-foreground">
                  {t("accounting.journalEntries.fields.description")}
                </label>
                <Textarea
                  value={description}
                  disabled={!canEdit}
                  onChange={(event) => setDescription(event.target.value)}
                  rows={1}
                />
              </div>
            </div>

            {/* Lines — immediately below the main form */}
            <div className="flex flex-col gap-2">
              <h2 className="text-card-title font-heading">
                {t("accounting.journalEntries.lines.account")}
              </h2>
              <JournalEntryLinesGrid
                lines={lines}
                accounts={accounts}
                costCenters={costCenters}
                projects={projects}
                onChange={setLines}
                disabled={!canEdit}
              />
            </div>

            <CreateOperationSummary
              title={t("common.summary")}
              rows={[
                {
                  label: t("accounting.journalEntries.fields.entryDate"),
                  value: entryDate ? formatDate(entryDate) : "—",
                },
                {
                  label: t("accounting.journalEntries.fields.journal"),
                  value: journals.find((journal) => journal.id === journalId)?.name ?? "—",
                },
                {
                  label: t("accounting.journalEntries.fields.partner"),
                  value:
                    partnerType === "customer"
                      ? (partnerCustomer?.name ?? "—")
                      : partnerType === "supplier"
                        ? (partnerSupplier?.name ?? "—")
                        : t("accounting.journalEntries.fields.noPartner"),
                },
                {
                  label: t("accounting.journalEntries.fields.currency"),
                  value: currency?.code ?? "—",
                },
                {
                  label: t("accounting.journalEntries.fields.totalDebit"),
                  value: <MoneyValue value={totalDebit} currency={currency?.code ?? ""} />,
                },
                {
                  label: t("accounting.journalEntries.fields.totalCredit"),
                  value: <MoneyValue value={totalCredit} currency={currency?.code ?? ""} />,
                },
              ]}
            />

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

      <ConfirmationDialog
        open={postTarget}
        onOpenChange={setPostTarget}
        title={t("accounting.journalEntries.confirmPostTitle")}
        description={t("accounting.journalEntries.confirmPostDescription")}
        confirmLabel={t("accounting.journalEntries.actions.post")}
        cancelLabel={t("common.close")}
        onConfirm={async () => {
          setPostTarget(false);
          await runTransition(
            (eid) => journalEntriesService.post(eid),
            "accounting.journalEntries.toasts.posted",
          );
        }}
      />

      <ConfirmationDialog
        open={reverseTarget}
        onOpenChange={setReverseTarget}
        tone="destructive"
        title={t("accounting.journalEntries.confirmReverseTitle")}
        description={t("accounting.journalEntries.confirmReverseDescription")}
        confirmLabel={t("accounting.journalEntries.actions.reverse")}
        cancelLabel={t("common.close")}
        onConfirm={async () => {
          setReverseTarget(false);
          const reversed = await journalEntriesService.reverse(id!).catch((error) => {
            toast.error(error instanceof ApiError ? error.message : "Something went wrong.");
            return null;
          });
          if (reversed) {
            toast.success(t("accounting.journalEntries.toasts.reversed"));
            router.push(`/finance/journal-entries/${reversed.id}`);
          }
        }}
      />

      <ConfirmationDialog
        open={archiveTarget}
        onOpenChange={setArchiveTarget}
        tone="destructive"
        title={t("accounting.journalEntries.confirmArchiveTitle")}
        description={t("accounting.journalEntries.confirmArchiveDescription")}
        confirmLabel={t("common.archive")}
        cancelLabel={t("common.close")}
        onConfirm={async () => {
          setArchiveTarget(false);
          await runTransition(
            (eid) => journalEntriesService.archive(eid),
            "accounting.journalEntries.toasts.archived",
          );
          router.push("/finance/journal-entries");
        }}
      />

      <ConfirmationDialog
        open={deleteTarget}
        onOpenChange={setDeleteTarget}
        tone="destructive"
        title={t("accounting.journalEntries.confirmDeleteTitle")}
        description={t("accounting.journalEntries.confirmDeleteDescription")}
        confirmLabel={t("common.delete")}
        cancelLabel={t("common.close")}
        onConfirm={async () => {
          setDeleteTarget(false);
          await handleDelete();
        }}
      />

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
