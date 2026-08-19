"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Archive,
  ChevronDown,
  ChevronRight,
  Download,
  FileText,
  Pencil,
  Plus,
  Printer,
  RotateCcw,
} from "lucide-react";
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
import { PageWorkspace } from "@/components/shared/page-workspace";
import { ListSurface, ListToolbar } from "@/components/shared/data-table/list-surface";
import { EmptyState } from "@/components/shared/empty-state";
import { EnterpriseModal } from "@/components/shared/enterprise-modal";
import { ConfirmationDialog } from "@/components/shared/confirmation-dialog";
import { LoadingOverlay } from "@/components/shared/loading-overlay";
import { AccountPicker } from "@/components/business/account-picker";
import { StatusBadge } from "@/components/business/status-badge";
import { createMasterDataService } from "@/services/master-data-service";
import type { ChartOfAccountRow } from "@/config/master-data/entities";
import { useCurrencies } from "@/hooks/use-reference-data";
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
import { RowActionsMenu } from "@/components/shared/data-table";

const service = createMasterDataService<ChartOfAccountRow>("/chart-of-accounts");

const ACCOUNT_TYPES = ["ASSET", "LIABILITY", "EQUITY", "REVENUE", "EXPENSE"] as const;

const ACCOUNT_TYPE_LABEL_KEY: Record<(typeof ACCOUNT_TYPES)[number], MessageKey> = {
  ASSET: "masterData.fields.accountTypeAsset",
  LIABILITY: "masterData.fields.accountTypeLiability",
  EQUITY: "masterData.fields.accountTypeEquity",
  REVENUE: "masterData.fields.accountTypeRevenue",
  EXPENSE: "masterData.fields.accountTypeExpense",
};

type AccountNature = "MAIN" | "SUB";

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
  nature: AccountNature;
  currencyId: string;
  allowReconciliation: boolean;
  description: string;
  /** Only ever sent to the server when non-empty — every account normally gets a server-generated code (Part 2/4/5); this is the privileged-admin escape hatch only. */
  codeOverride: string;
}

const emptyForm: FormState = {
  name: "",
  accountType: "ASSET",
  nature: "MAIN",
  currencyId: "",
  allowReconciliation: false,
  description: "",
  codeOverride: "",
};

/** TASK-053/CRITICAL-GAP-FIX — the accountant workflow: hierarchy tree (unlimited depth), collapse/expand, fast search, Account Type/Status filters, and a unified create/edit form with an explicit Main/Sub account-nature selector + searchable Parent Account picker. Reuses the tree-page pattern already established by Warehouse Locations. */
function ChartOfAccountsPageContent() {
  const { t } = useLocale();
  const { printList } = usePrintEngine();
  const { activeCompany } = useCompany();
  const { user, hasPermission } = useUserContext();
  const canOverrideCode = hasPermission("accounting.chart-of-accounts.override-code");
  const canCreate = hasPermission("accounting.chart-of-accounts.create");
  const canEdit = hasPermission("accounting.chart-of-accounts.edit");
  const canDelete = hasPermission("accounting.chart-of-accounts.delete");

  const [accounts, setAccounts] = useState<ChartOfAccountRow[]>([]);
  const currencies = useCurrencies();
  const [isLoading, setIsLoading] = useState(true);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("");
  const [showArchived, setShowArchived] = useState(false);

  const [modalOpen, setModalOpen] = useState(false);
  const [editingAccount, setEditingAccount] = useState<ChartOfAccountRow | null>(null);
  const [parentAccount, setParentAccount] = useState<ChartOfAccountRow | null>(null);
  const [excludeIds, setExcludeIds] = useState<string[]>([]);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [proposedCode, setProposedCode] = useState<string | null>(null);
  const [isCodeLoading, setIsCodeLoading] = useState(false);
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

  // Fetches the server-proposed code whenever the create form's classification/nature/parent
  // changes — never during edit (Part 15: an existing account's code never gets silently
  // recomputed, even if its parent changes).
  useEffect(() => {
    if (!modalOpen || editingAccount) return;
    if (form.nature === "SUB" && !parentAccount) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setProposedCode(null);
      return;
    }
    let cancelled = false;
    setIsCodeLoading(true);
    const url =
      form.nature === "SUB"
        ? `/chart-of-accounts/${parentAccount!.id}/next-code`
        : `/chart-of-accounts/next-code?accountType=${form.accountType}`;
    apiClient
      .get<{ code: string }>(url)
      .then((result) => {
        if (!cancelled) setProposedCode(result.code);
      })
      .catch(() => {
        if (!cancelled) setProposedCode(null);
      })
      .finally(() => {
        if (!cancelled) setIsCodeLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [modalOpen, editingAccount, form.nature, form.accountType, parentAccount]);

  const openCreate = (parent: ChartOfAccountRow | null) => {
    setEditingAccount(null);
    setParentAccount(parent);
    setExcludeIds([]);
    setProposedCode(null);
    setForm(
      parent
        ? { ...emptyForm, nature: "SUB", accountType: parent.accountType }
        : { ...emptyForm, nature: "MAIN" },
    );
    setModalOpen(true);
  };

  const openEdit = async (account: ChartOfAccountRow) => {
    setEditingAccount(account);
    setParentAccount(null);
    setProposedCode(null);
    setForm({
      name: account.name,
      accountType: account.accountType,
      nature: account.parentAccountId ? "SUB" : "MAIN",
      currencyId: account.currencyId ?? "",
      allowReconciliation: account.allowReconciliation,
      description: account.description ?? "",
      codeOverride: "",
    });
    setModalOpen(true);
    if (account.parentAccountId) {
      service
        .get(account.parentAccountId)
        .then(setParentAccount)
        .catch(() => setParentAccount(null));
    }
    try {
      const descendants = await apiClient.get<string[]>(
        `/chart-of-accounts/${account.id}/descendants`,
      );
      setExcludeIds([account.id, ...descendants]);
    } catch {
      setExcludeIds([account.id]);
    }
  };

  const submit = async () => {
    if (!form.name.trim()) {
      toast.error(t("masterData.fields.name"));
      return;
    }
    if (form.nature === "SUB" && !parentAccount) {
      toast.error(t("masterData.chartOfAccounts.parentRequired"));
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
        payload.parentAccountId = form.nature === "SUB" ? parentAccount?.id : null;
        await service.update(editingAccount.id, payload);
      } else {
        payload.parentAccountId = form.nature === "SUB" ? parentAccount?.id : undefined;
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
      toast.success(t("masterData.chartOfAccounts.deleteSuccess"));
      setArchiveTarget(null);
      await load();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Failed to delete.");
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

  const expandAll = () => setCollapsed(new Set());
  const collapseAll = () => {
    const withChildren = accounts.filter((a) => accounts.some((b) => b.parentAccountId === a.id));
    setCollapsed(new Set(withChildren.map((a) => a.id)));
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
          {isArchived && <StatusBadge label={t("common.archived")} tone="neutral" />}
          <StatusBadge
            label={
              node.allowsPosting
                ? t("masterData.chartOfAccounts.postingAccount")
                : t("masterData.chartOfAccounts.groupAccount")
            }
            tone={node.allowsPosting ? "success" : "neutral"}
          />
          <div className="ms-auto">
            <RowActionsMenu
              label={t("common.actions")}
              actions={[
                {
                  key: "edit",
                  label: t("common.edit"),
                  icon: Pencil,
                  hidden: isArchived || !canEdit,
                  onSelect: () => openEdit(node),
                },
                {
                  key: "add-child",
                  label: t("masterData.chartOfAccounts.addChild"),
                  icon: Plus,
                  hidden: isArchived || !canCreate,
                  onSelect: () => openCreate(node),
                },
                {
                  key: "archive",
                  label: t("masterData.chartOfAccounts.deleteAction"),
                  icon: Archive,
                  hidden: isArchived || !canDelete || node.isSystemAccount,
                  disabled: node.isSystemAccount,
                  destructive: true,
                  separatorBefore: true,
                  onSelect: () => setArchiveTarget(node),
                },
                {
                  key: "restore",
                  label: t("common.restore"),
                  icon: RotateCcw,
                  hidden: !isArchived || !canDelete,
                  onSelect: () => setRestoreTarget(node),
                },
              ]}
            />
          </div>
        </div>
        {!isCollapsed && node.children.map((child) => renderNode(child, depth + 1))}
      </div>
    );
  };

  const displayedCode = editingAccount ? editingAccount.code : proposedCode;

  return (
    <PageWorkspace
      title={t("masterData.chartOfAccounts.title")}
      description={t("masterData.chartOfAccounts.description")}
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
          <EnterpriseButton type="button" onClick={() => openCreate(null)}>
            <Plus />
            {t("masterData.chartOfAccounts.addAccount")}
          </EnterpriseButton>
        </div>
      }
    >
      <ListSurface>
        {isMutating && <LoadingOverlay />}
        <ListToolbar>
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t("masterData.chartOfAccounts.searchPlaceholder")}
            className="h-(--control-height-sm) max-w-(--width-control-search)"
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
          <div className="ms-auto flex flex-wrap items-center gap-2">
            <EnterpriseButton type="button" variant="outline" size="sm" onClick={expandAll}>
              {t("masterData.chartOfAccounts.expandAll")}
            </EnterpriseButton>
            <EnterpriseButton type="button" variant="outline" size="sm" onClick={collapseAll}>
              {t("masterData.chartOfAccounts.collapseAll")}
            </EnterpriseButton>
          </div>
        </ListToolbar>
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
      </ListSurface>

      <EnterpriseModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        size="md"
        icon={FileText}
        title={editingAccount ? t("common.edit") : t("masterData.chartOfAccounts.addAccount")}
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
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <label className="text-sm font-medium">
              {t("masterData.fields.name")} <span className="text-destructive">*</span>
            </label>
            <Input
              value={form.name}
              onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium">
              {t("masterData.fields.accountType")} <span className="text-destructive">*</span>
            </label>
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
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium">
              {t("masterData.chartOfAccounts.natureLabel")}{" "}
              <span className="text-destructive">*</span>
            </label>
            <Select
              value={form.nature}
              onValueChange={(value) => {
                const nature = value as AccountNature;
                setForm((current) => ({ ...current, nature }));
                if (nature === "MAIN") setParentAccount(null);
              }}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="MAIN">{t("masterData.chartOfAccounts.natureMain")}</SelectItem>
                <SelectItem value="SUB">{t("masterData.chartOfAccounts.natureSub")}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {form.nature === "SUB" && (
            <div className="flex flex-col gap-1.5 sm:col-span-2">
              <label className="text-sm font-medium">
                {t("masterData.fields.parentAccount")} <span className="text-destructive">*</span>
              </label>
              <AccountPicker
                value={parentAccount}
                onChange={setParentAccount}
                accountType={form.accountType}
                excludeIds={excludeIds}
                placeholder={t("masterData.chartOfAccounts.selectParent")}
              />
              <p className="text-caption text-muted-foreground">
                {t("masterData.chartOfAccounts.parentHint")}
              </p>
            </div>
          )}

          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <label className="text-sm font-medium">{t("masterData.fields.code")}</label>
            <code dir="ltr" className="rounded bg-muted px-2 py-2 text-sm">
              {editingAccount
                ? displayedCode
                : isCodeLoading
                  ? t("common.loading")
                  : (displayedCode ?? "—")}
            </code>
            <p className="text-caption text-muted-foreground">
              {t("masterData.chartOfAccounts.proposedCodeHint")}
            </p>
          </div>

          {canOverrideCode && (
            <div className="flex flex-col gap-1.5 sm:col-span-2">
              <label className="text-sm font-medium">
                {t("masterData.chartOfAccounts.codeOverrideLabel")}
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

          {editingAccount && (
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium">{t("common.status")}</label>
              <div>
                <StatusBadge
                  label={
                    editingAccount.allowsPosting
                      ? t("masterData.chartOfAccounts.postingAccount")
                      : t("masterData.chartOfAccounts.groupAccount")
                  }
                  tone={editingAccount.allowsPosting ? "success" : "neutral"}
                />
              </div>
            </div>
          )}

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
        title={t("masterData.chartOfAccounts.confirmDeleteTitle")}
        description={
          archiveTarget &&
          `${archiveTarget.code} — ${archiveTarget.name} — ${t("masterData.chartOfAccounts.confirmDeleteDescription")}`
        }
        onConfirm={confirmArchive}
        confirmLabel={t("masterData.chartOfAccounts.deleteAction")}
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
    </PageWorkspace>
  );
}

export default function ChartOfAccountsPage() {
  return (
    <PermissionGate permission="accounting.chart-of-accounts.view">
      <ChartOfAccountsPageContent />
    </PermissionGate>
  );
}
