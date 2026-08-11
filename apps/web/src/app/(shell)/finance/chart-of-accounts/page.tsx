"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Download, FileText, Printer, Plus } from "lucide-react";
import { EnterpriseButton } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { EnterpriseModal } from "@/components/shared/enterprise-modal";
import { ConfirmationDialog } from "@/components/shared/confirmation-dialog";
import { LoadingOverlay } from "@/components/shared/loading-overlay";
import { createMasterDataService } from "@/services/master-data-service";
import type { ChartOfAccountRow, CurrencyRow } from "@/config/master-data/entities";
import { usePrintEngine } from "@/hooks/use-print-engine";
import { useCompany } from "@/providers/company-provider";
import { useUserContext } from "@/providers/user-context";
import { useLocale } from "@/providers/locale-provider";
import { toast } from "@/lib/toast";
import { ApiError, apiClient } from "@/services/api-client";
import { ModuleImportButtons } from "@/components/shared/module-import-buttons";
import { exportRowsToCsv } from "@/components/master-data/enterprise-data-table";
import { siteConfig } from "@/config/site";
import type { MessageKey } from "@/i18n/translate";
import { PermissionGate } from "@/components/shared/permission-gate";

const service = createMasterDataService<ChartOfAccountRow>("/chart-of-accounts");
const currenciesService = createMasterDataService<CurrencyRow>("/currencies");

const ACCOUNT_TYPES = ["ASSET", "LIABILITY", "EQUITY", "REVENUE", "EXPENSE"] as const;

const ACCOUNT_TYPE_LABEL_KEY: Record<(typeof ACCOUNT_TYPES)[number], MessageKey> = {
  ASSET: "masterData.fields.accountTypeAsset",
  LIABILITY: "masterData.fields.accountTypeLiability",
  EQUITY: "masterData.fields.accountTypeEquity",
  REVENUE: "masterData.fields.accountTypeRevenue",
  EXPENSE: "masterData.fields.accountTypeExpense",
};

interface TreeNode extends ChartOfAccountRow {
  children: TreeNode[];
}

function buildTree(accounts: ChartOfAccountRow[]): TreeNode[] {
  const nodes = new Map<string, TreeNode>(
    accounts.map((account) => [account.id, { ...account, children: [] }]),
  );
  const roots: TreeNode[] = [];
  for (const node of nodes.values()) {
    if (node.parentAccountId && nodes.has(node.parentAccountId)) {
      nodes.get(node.parentAccountId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }
  return roots;
}

function collectMatchIds(nodes: TreeNode[], query: string, ancestors: string[] = []): Set<string> {
  const matches = new Set<string>();
  for (const node of nodes) {
    const isMatch =
      node.code.toLowerCase().includes(query) || node.name.toLowerCase().includes(query);
    const childMatches = collectMatchIds(node.children, query, [...ancestors, node.id]);
    if (isMatch || childMatches.size > 0) {
      matches.add(node.id);
      for (const ancestorId of ancestors) matches.add(ancestorId);
      for (const id of childMatches) matches.add(id);
    }
  }
  return matches;
}

interface FormState {
  name: string;
  accountType: (typeof ACCOUNT_TYPES)[number];
  currencyId: string;
  allowReconciliation: boolean;
  description: string;
  /** Only ever sent to the server when non-empty — a child account normally gets a server-generated code (Part 12); this is the privileged-admin escape hatch, and the only way at all to set a root account's code. */
  codeOverride: string;
}

const emptyForm: FormState = {
  name: "",
  accountType: "ASSET",
  currencyId: "",
  allowReconciliation: false,
  description: "",
  codeOverride: "",
};

/** TASK-053 — the accountant workflow: hierarchy tree, collapse/expand, fast search, Account Type/Status filters. Reuses the tree-page pattern already established by Warehouse Locations. */
function ChartOfAccountsPageContent() {
  const { t } = useLocale();
  const { printList } = usePrintEngine();
  const { activeCompany } = useCompany();
  const { user, hasPermission } = useUserContext();
  const canOverrideCode = hasPermission("accounting.chart-of-accounts.override-code");

  const [accounts, setAccounts] = useState<ChartOfAccountRow[]>([]);
  const [currencies, setCurrencies] = useState<CurrencyRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("");
  const [showArchived, setShowArchived] = useState(false);

  const [modalOpen, setModalOpen] = useState(false);
  const [editingAccount, setEditingAccount] = useState<ChartOfAccountRow | null>(null);
  const [parentForNew, setParentForNew] = useState<ChartOfAccountRow | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [proposedCode, setProposedCode] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [archiveTarget, setArchiveTarget] = useState<ChartOfAccountRow | null>(null);
  const [restoreTarget, setRestoreTarget] = useState<ChartOfAccountRow | null>(null);
  const [isMutating, setIsMutating] = useState(false);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const result = await service.list({ pageSize: 500, includeArchived: true });
      setAccounts(result.items);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Failed to load accounts.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  useEffect(() => {
    currenciesService
      .list({ pageSize: 200 })
      .then((result) => setCurrencies(result.items))
      .catch(() => setCurrencies([]));
  }, []);

  const visibleAccounts = useMemo(
    () =>
      accounts.filter((account) => {
        if (!showArchived && account.deletedAt) return false;
        if (typeFilter && account.accountType !== typeFilter) return false;
        return true;
      }),
    [accounts, showArchived, typeFilter],
  );

  const tree = useMemo(() => buildTree(visibleAccounts), [visibleAccounts]);

  const matchIds = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return null;
    return collectMatchIds(tree, query);
  }, [tree, search]);

  const openCreate = async (parent: ChartOfAccountRow | null) => {
    if (!parent && !canOverrideCode) {
      toast.error(t("masterData.chartOfAccounts.rootRequiresPermission"));
      return;
    }
    setEditingAccount(null);
    setParentForNew(parent);
    setProposedCode(null);
    setForm(parent ? { ...emptyForm, accountType: parent.accountType } : emptyForm);
    setModalOpen(true);
    if (parent) {
      try {
        const result = await apiClient.get<{ code: string }>(
          `/chart-of-accounts/${parent.id}/next-code`,
        );
        setProposedCode(result.code);
      } catch {
        setProposedCode(null);
      }
    }
  };
  const openEdit = (account: ChartOfAccountRow) => {
    setEditingAccount(account);
    setParentForNew(null);
    setProposedCode(null);
    setForm({
      name: account.name,
      accountType: account.accountType,
      currencyId: account.currencyId ?? "",
      allowReconciliation: account.allowReconciliation,
      description: account.description ?? "",
      codeOverride: "",
    });
    setModalOpen(true);
  };

  const submit = async () => {
    if (!form.name.trim()) {
      toast.error(t("masterData.fields.name"));
      return;
    }
    if (!editingAccount && !parentForNew && !form.codeOverride.trim()) {
      toast.error(t("masterData.chartOfAccounts.rootCodeRequired"));
      return;
    }
    setIsSubmitting(true);
    try {
      const payload: Record<string, unknown> = {
        name: form.name,
        accountType: form.accountType,
        currencyId: form.currencyId || undefined,
        allowReconciliation: form.allowReconciliation,
        description: form.description || undefined,
      };
      if (form.codeOverride.trim()) payload.codeOverride = form.codeOverride.trim();
      if (editingAccount) {
        await service.update(editingAccount.id, payload);
      } else {
        payload.parentAccountId = parentForNew?.id ?? undefined;
        await service.create(payload);
      }
      toast.success(t("common.save"));
      setModalOpen(false);
      await load();
    } catch (error) {
      toast.error(
        error instanceof ApiError
          ? error.message
          : t("masterData.chartOfAccounts.invalidHierarchy"),
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const confirmArchive = async () => {
    if (!archiveTarget) return;
    setIsMutating(true);
    try {
      await service.archive(archiveTarget.id);
      toast.success(t("common.archive"));
      setArchiveTarget(null);
      await load();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Failed to archive.");
    } finally {
      setIsMutating(false);
    }
  };

  const confirmRestore = async () => {
    if (!restoreTarget) return;
    setIsMutating(true);
    try {
      await service.restore(restoreTarget.id);
      toast.success(t("common.restore"));
      setRestoreTarget(null);
      await load();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Failed to restore.");
    } finally {
      setIsMutating(false);
    }
  };

  const toggleCollapsed = (id: string) => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const flattenForExport = (nodes: TreeNode[]): Record<string, string>[] =>
    nodes.flatMap((node) => [
      {
        code: node.code,
        name: node.name,
        accountType: t(ACCOUNT_TYPE_LABEL_KEY[node.accountType]),
        currency: node.currency?.code ?? "",
        status: node.deletedAt
          ? t("common.archived")
          : t("masterData.chartOfAccounts.filters.active"),
      },
      ...flattenForExport(node.children),
    ]);

  const handleExport = () => {
    exportRowsToCsv(
      flattenForExport(tree),
      ["code", "name", "accountType", "currency", "status"],
      "chart-of-accounts.csv",
    );
  };

  const handlePrint = () => {
    printList({
      variant: "list",
      title: t("masterData.chartOfAccounts.title"),
      company: {
        name: activeCompany?.name ?? siteConfig.fullName,
        logoUrl: activeCompany?.logoUrl ?? null,
      },
      printedByName: user?.fullName ?? null,
      columns: [
        { key: "code", label: t("masterData.fields.code") },
        { key: "name", label: t("masterData.fields.name") },
        { key: "accountType", label: t("masterData.fields.accountType") },
        { key: "currency", label: t("masterData.fields.currency") },
        { key: "status", label: t("common.status") },
      ],
      rows: flattenForExport(tree),
    });
  };

  const renderNode = (node: TreeNode, depth: number) => {
    const isCollapsed = collapsed.has(node.id);
    const isArchived = !!node.deletedAt;
    if (matchIds && !matchIds.has(node.id)) return null;
    return (
      <div key={node.id}>
        <div
          className="flex flex-wrap items-center gap-2 rounded-lg border border-transparent px-2 py-2 hover:border-border hover:bg-muted/40"
          style={{ paddingInlineStart: `${depth * 1.75 + 0.5}rem` }}
        >
          {node.children.length > 0 ? (
            <button
              type="button"
              onClick={() => toggleCollapsed(node.id)}
              className="flex size-5 shrink-0 items-center justify-center text-muted-foreground"
              aria-label={isCollapsed ? t("common.expand") : t("common.collapse")}
            >
              {isCollapsed ? (
                <ChevronRight className="size-4 rtl:rotate-180" />
              ) : (
                <ChevronDown className="size-4" />
              )}
            </button>
          ) : (
            <span className="size-5 shrink-0" />
          )}
          <FileText className="size-3.5 shrink-0 text-muted-foreground" />
          <code dir="ltr" className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
            {node.code}
          </code>
          <span className="font-medium">{node.name}</span>
          <span className="text-caption text-muted-foreground">
            {t(ACCOUNT_TYPE_LABEL_KEY[node.accountType])}
          </span>
          {isArchived && (
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
              {t("common.archived")}
            </span>
          )}
          {!node.allowsPosting && (
            <span
              className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground"
              title={t("masterData.chartOfAccounts.headerAccountBadge")}
            >
              {t("masterData.chartOfAccounts.headerAccountBadge")}
            </span>
          )}
          <div className="ms-auto flex items-center gap-1">
            {!isArchived && (
              <>
                <EnterpriseButton
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => openCreate(node)}
                >
                  {t("masterData.chartOfAccounts.addChild")}
                </EnterpriseButton>
                <EnterpriseButton
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => openEdit(node)}
                >
                  {t("common.edit")}
                </EnterpriseButton>
                <EnterpriseButton
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setArchiveTarget(node)}
                >
                  {t("common.archive")}
                </EnterpriseButton>
              </>
            )}
            {isArchived && (
              <EnterpriseButton
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setRestoreTarget(node)}
              >
                {t("common.restore")}
              </EnterpriseButton>
            )}
          </div>
        </div>
        {!isCollapsed && node.children.map((child) => renderNode(child, depth + 1))}
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t("masterData.chartOfAccounts.title")}
        subtitle={t("masterData.chartOfAccounts.description")}
        actions={
          <div className="flex items-center gap-2">
            <ModuleImportButtons importType="CHART_OF_ACCOUNTS" onImported={load} />
            <EnterpriseButton
              type="button"
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={handleExport}
            >
              <Download className="size-3.5" />
              {t("table.export")}
            </EnterpriseButton>
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
            <EnterpriseButton
              type="button"
              onClick={() => openCreate(null)}
              disabled={!canOverrideCode}
              title={
                canOverrideCode ? undefined : t("masterData.chartOfAccounts.rootRequiresPermission")
              }
            >
              <Plus />
              {t("masterData.chartOfAccounts.addAccount")}
            </EnterpriseButton>
          </div>
        }
        filters={
          <>
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t("masterData.chartOfAccounts.searchPlaceholder")}
              className="w-56"
            />
            <Select
              value={typeFilter || "__all__"}
              onValueChange={(v) => setTypeFilter(v === "__all__" ? "" : v)}
            >
              <SelectTrigger size="sm" className="w-40">
                <SelectValue placeholder={t("masterData.fields.accountType")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">
                  {t("masterData.chartOfAccounts.filters.allTypes")}
                </SelectItem>
                {ACCOUNT_TYPES.map((type) => (
                  <SelectItem key={type} value={type}>
                    {t(ACCOUNT_TYPE_LABEL_KEY[type])}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <EnterpriseButton
              type="button"
              variant={showArchived ? "secondary" : "outline"}
              size="sm"
              onClick={() => setShowArchived((value) => !value)}
            >
              {t("common.showArchived")}
            </EnterpriseButton>
          </>
        }
      />

      <div className="relative rounded-xl border shadow-sm">
        {isMutating && <LoadingOverlay />}
        <div className="min-h-40 p-2">
          {isLoading ? (
            <div className="flex h-32 items-center justify-center text-caption text-muted-foreground">
              {t("common.loading")}
            </div>
          ) : tree.length === 0 ? (
            <EmptyState icon={FileText} title={t("masterData.chartOfAccounts.empty")} />
          ) : (
            tree.map((node) => renderNode(node, 0))
          )}
        </div>
      </div>

      <EnterpriseModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        size="md"
        icon={FileText}
        title={editingAccount ? t("common.edit") : t("masterData.chartOfAccounts.addAccount")}
        description={
          parentForNew
            ? `${t("masterData.fields.parentAccount")}: ${parentForNew.code} — ${parentForNew.name}`
            : undefined
        }
        footer={(requestClose) => (
          <>
            <EnterpriseButton
              type="button"
              variant="ghost"
              onClick={requestClose}
              disabled={isSubmitting}
            >
              {t("common.cancel")}
            </EnterpriseButton>
            <EnterpriseButton type="button" onClick={submit} disabled={isSubmitting}>
              {t("common.save")}
            </EnterpriseButton>
          </>
        )}
      >
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium">{t("masterData.fields.code")}</label>
            {editingAccount ? (
              <code dir="ltr" className="rounded bg-muted px-2 py-2 text-sm text-muted-foreground">
                {editingAccount.code}
              </code>
            ) : parentForNew ? (
              <code dir="ltr" className="rounded bg-muted px-2 py-2 text-sm">
                {proposedCode ?? t("common.loading")}
              </code>
            ) : (
              <span className="text-caption text-muted-foreground">
                {t("masterData.chartOfAccounts.rootCodeRequired")}
              </span>
            )}
            {!editingAccount && parentForNew && (
              <p className="text-caption text-muted-foreground">
                {t("masterData.chartOfAccounts.proposedCodeHint")}
              </p>
            )}
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium">
              {t("masterData.fields.name")} <span className="text-destructive">*</span>
            </label>
            <Input
              value={form.name}
              onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
            />
          </div>
          {canOverrideCode && (
            <div className="flex flex-col gap-1.5 sm:col-span-2">
              <label className="text-sm font-medium">
                {t("masterData.chartOfAccounts.codeOverrideLabel")}
                {!editingAccount && !parentForNew && <span className="text-destructive"> *</span>}
              </label>
              <Input
                dir="ltr"
                value={form.codeOverride}
                onChange={(event) =>
                  setForm((current) => ({ ...current, codeOverride: event.target.value }))
                }
              />
              <p className="text-caption text-muted-foreground">
                {t("masterData.chartOfAccounts.codeOverrideHint")}
              </p>
            </div>
          )}
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium">{t("masterData.fields.accountType")}</label>
            {parentForNew ? (
              <span className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm">
                {t(ACCOUNT_TYPE_LABEL_KEY[form.accountType])}
              </span>
            ) : (
              <Select
                value={form.accountType}
                onValueChange={(value) =>
                  setForm((current) => ({
                    ...current,
                    accountType: value as FormState["accountType"],
                  }))
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ACCOUNT_TYPES.map((type) => (
                    <SelectItem key={type} value={type}>
                      {t(ACCOUNT_TYPE_LABEL_KEY[type])}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium">{t("masterData.fields.currency")}</label>
            <Select
              value={form.currencyId || "__none__"}
              onValueChange={(value) =>
                setForm((current) => ({
                  ...current,
                  currencyId: value === "__none__" ? "" : value,
                }))
              }
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">{t("common.none")}</SelectItem>
                {currencies.map((currency) => (
                  <SelectItem key={currency.id} value={currency.id}>
                    {currency.code}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <label className="text-sm font-medium">{t("masterData.fields.description")}</label>
            <Textarea
              value={form.description}
              onChange={(event) =>
                setForm((current) => ({ ...current, description: event.target.value }))
              }
            />
          </div>
          <div className="flex items-center gap-2 sm:col-span-2">
            <Checkbox
              checked={form.allowReconciliation}
              onCheckedChange={(checked) =>
                setForm((current) => ({ ...current, allowReconciliation: !!checked }))
              }
            />
            <label className="text-sm font-medium">
              {t("masterData.fields.allowReconciliation")}
            </label>
          </div>
        </div>
      </EnterpriseModal>

      <ConfirmationDialog
        open={!!archiveTarget}
        onOpenChange={(open) => !open && setArchiveTarget(null)}
        title={t("common.confirmArchiveTitle")}
        description={
          archiveTarget &&
          `${archiveTarget.code} — ${archiveTarget.name} — ${t("common.confirmArchiveDescription")}`
        }
        onConfirm={confirmArchive}
        confirmLabel={t("common.archive")}
      />

      <ConfirmationDialog
        open={!!restoreTarget}
        onOpenChange={(open) => !open && setRestoreTarget(null)}
        title={t("common.confirmRestoreTitle")}
        description={
          restoreTarget &&
          `${restoreTarget.code} — ${restoreTarget.name} — ${t("common.confirmRestoreDescription")}`
        }
        onConfirm={confirmRestore}
        confirmLabel={t("common.restore")}
      />
    </div>
  );
}

export default function ChartOfAccountsPage() {
  return (
    <PermissionGate permission="accounting.chart-of-accounts.view">
      <ChartOfAccountsPageContent />
    </PermissionGate>
  );
}
