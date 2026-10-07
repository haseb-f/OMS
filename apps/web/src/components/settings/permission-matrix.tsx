"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronDown, FoldVertical, UnfoldVertical } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { StatusBadge } from "@/components/business/status-badge";
import { SearchInput } from "@/components/shared/search-input";
import { EnterpriseButton } from "@/components/ui/button";
import {
  permissionsService,
  type PermissionCatalogGroup,
  type PermissionModuleDef,
} from "@/services/permissions-service";
import { useLocale } from "@/providers/locale-provider";
import type { MessageKey } from "@/i18n/translate";
import { cn } from "@/lib/utils";
import { normalizeArabicSearch } from "@/lib/arabic-search";
import {
  AGENT_PORTAL_SECTION_KEY,
  agentPermissionLabelKey,
} from "@/config/agents/agent-permissions";

const ACTION_LABEL_KEY: Record<string, MessageKey> = {
  view: "permissions.actions.view",
  create: "permissions.actions.create",
  edit: "permissions.actions.edit",
  delete: "permissions.actions.delete",
  confirm: "permissions.actions.confirm",
  approve: "permissions.actions.approve",
  cancel: "permissions.actions.cancel",
  post: "permissions.actions.post",
  reverse: "permissions.actions.reverse",
  print: "permissions.actions.print",
  export: "permissions.actions.export",
  import: "permissions.actions.import",
  manage: "permissions.actions.manage",
  duplicate_review: "permissions.actions.duplicateReview",
  lookup_advanced: "permissions.actions.lookupAdvanced",
  view_all: "permissions.actions.viewAll",
  amend: "permissions.actions.amend",
  direct_cost: "permissions.actions.directCost",
  assign_carrier: "permissionTemplates.actions.assignCarrier",
  manage_permissions: "permissionTemplates.actions.managePermissions",
};

const EMPTY: string[] = [];

/** R14 W2 — tri-state source of one permission for one user. */
type OverrideState = "inherit" | "grant" | "deny";

/** R14 W2 — individual overrides on top of the job-title template (user permission panel). */
export interface PermissionMatrixOverrides {
  inherited: string[];
  grants: string[];
  denies: string[];
  onChange: (next: { grants: string[]; denies: string[] }) => void;
}

/** Source chip: inherited / individual grant (± also inherited) / individual deny. */
function PermissionSourceChip({
  name,
  inherited,
  grants,
  denies,
}: {
  name: string;
  inherited: ReadonlySet<string>;
  grants: ReadonlySet<string>;
  denies: ReadonlySet<string>;
}) {
  const { t } = useLocale();
  if (denies.has(name)) {
    return <StatusBadge label={t("permissionTemplates.source.deny")} tone="destructive" />;
  }
  if (grants.has(name)) {
    const label = inherited.has(name)
      ? `${t("permissionTemplates.source.grant")} · ${t("permissionTemplates.source.alsoInherited")}`
      : t("permissionTemplates.source.grant");
    return <StatusBadge label={label} tone="success" />;
  }
  if (inherited.has(name)) {
    return <StatusBadge label={t("permissionTemplates.source.inherited")} tone="info" />;
  }
  return null;
}

/**
 * TASK-060 Part 11 — the Permission Matrix (Daftra-style): one module per
 * row, compact, expandable, sticky header, fast search, per-module Select
 * All, global Expand/Collapse All, and a granted-count badge per row.
 * Purely controlled — `value` is the full list of granted permission names,
 * `onChange` always receives the full next list (never a delta), matching
 * `PUT /users/:id/permissions`'s own "always saves the full checked list"
 * contract.
 *
 * R14 W2 — with `overrides` the same matrix edits a user's individual
 * overrides: every action shows its source chip (inherited / individual
 * grant / individual deny) and an Inherit / Grant / Deny control; `value` /
 * `onChange` are not used. Job-title templates use the checkbox mode.
 */
export function PermissionMatrix({
  value = EMPTY,
  onChange,
  disabled,
  audience = "internal",
  overrides,
}: {
  value?: string[];
  onChange?: (next: string[]) => void;
  disabled?: boolean;
  overrides?: PermissionMatrixOverrides;
  /**
   * Agents milestone (spec §3): an INTERNAL user sees every section except
   * the agent portal; an AGENT user sees only the agent-portal section (the
   * server rejects cross-type grants either way).
   */
  audience?: "internal" | "agent";
}) {
  const { t } = useLocale();
  const [groups, setGroups] = useState<PermissionCatalogGroup[] | null>(null);
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    permissionsService
      .getCatalog()
      .then((catalog) =>
        setGroups(
          catalog.filter(
            (group) => (group.sectionKey === AGENT_PORTAL_SECTION_KEY) === (audience === "agent"),
          ),
        ),
      )
      .catch(() => setGroups([]));
  }, [audience]);

  const allModules = useMemo(() => groups?.flatMap((group) => group.modules) ?? [], [groups]);

  const inheritedSet = useMemo(() => new Set(overrides?.inherited ?? []), [overrides?.inherited]);
  const grantSet = useMemo(() => new Set(overrides?.grants ?? []), [overrides?.grants]);
  const denySet = useMemo(() => new Set(overrides?.denies ?? []), [overrides?.denies]);
  // Tri-state mode counts what the user ends up holding at key level:
  // (template ∪ grants) − denies.
  const isOverrideMode = overrides !== undefined;
  const granted = useMemo(
    () =>
      isOverrideMode
        ? new Set([...inheritedSet, ...grantSet].filter((name) => !denySet.has(name)))
        : new Set(value),
    [isOverrideMode, inheritedSet, grantSet, denySet, value],
  );

  const filteredGroups = useMemo(() => {
    if (!groups) return [];
    const query = normalizeArabicSearch(search);
    if (!query) return groups;
    return groups
      .map((group) => {
        const sectionLabel = group.sectionLabelKey
          ? normalizeArabicSearch(t(group.sectionLabelKey as MessageKey))
          : "";
        if (sectionLabel.includes(query)) return group;
        const modules = group.modules.filter((module) =>
          normalizeArabicSearch(`${t(module.labelKey as MessageKey)} ${module.key}`).includes(
            query,
          ),
        );
        return modules.length > 0 ? { ...group, modules } : null;
      })
      .filter((group): group is PermissionCatalogGroup => group !== null);
  }, [groups, search, t]);

  const toggleExpanded = (key: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const expandAll = () => setExpanded(new Set(allModules.map((m) => m.key)));
  const collapseAll = () => setExpanded(new Set());

  const overrideStateOf = (name: string): OverrideState =>
    denySet.has(name) ? "deny" : grantSet.has(name) ? "grant" : "inherit";

  const setOverride = (name: string, state: OverrideState) => {
    if (disabled || !overrides) return;
    const grants = new Set(grantSet);
    const denies = new Set(denySet);
    grants.delete(name);
    denies.delete(name);
    if (state === "grant") grants.add(name);
    if (state === "deny") denies.add(name);
    overrides.onChange({ grants: [...grants], denies: [...denies] });
  };

  const setPermission = (name: string, checked: boolean) => {
    if (disabled || !onChange) return;
    const next = new Set(value);
    if (checked) next.add(name);
    else next.delete(name);
    onChange([...next]);
  };

  const toggleModule = (module: PermissionModuleDef, checked: boolean) => {
    if (disabled || !onChange) return;
    const next = new Set(value);
    for (const action of module.actions) {
      if (checked) next.add(action.name);
      else next.delete(action.name);
    }
    onChange([...next]);
  };

  const totalGrantedCount = granted.size;

  const actionLabel = (action: { name: string; action: string }) =>
    t(
      action.name.startsWith("agent.")
        ? agentPermissionLabelKey(action.name)
        : (ACTION_LABEL_KEY[action.action] ?? (action.action as MessageKey)),
    );

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SearchInput
          value={search}
          onValueChange={setSearch}
          placeholder={t("permissions.searchPlaceholder")}
        />
        <div className="flex items-center gap-2">
          <span className="text-caption text-muted-foreground">
            {t("permissions.totalGranted", { count: String(totalGrantedCount) })}
          </span>
          <EnterpriseButton
            type="button"
            variant="ghost"
            size="sm"
            className="gap-1.5"
            onClick={expandAll}
          >
            <UnfoldVertical className="size-3.5" />
            {t("permissions.expandAll")}
          </EnterpriseButton>
          <EnterpriseButton
            type="button"
            variant="ghost"
            size="sm"
            className="gap-1.5"
            onClick={collapseAll}
          >
            <FoldVertical className="size-3.5" />
            {t("permissions.collapseAll")}
          </EnterpriseButton>
        </div>
      </div>

      <div className="max-h-[26rem] overflow-y-auto rounded-md border border-border">
        <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-border bg-table-header px-3 py-1.5 text-caption font-medium text-table-header-foreground">
          <span className="w-5" />
          <span className="flex-1">{t("permissions.columnModule")}</span>
          <span className="w-16 text-end">{t("permissions.columnGranted")}</span>
        </div>

        {groups === null ? (
          <div className="p-6 text-center text-caption text-muted-foreground">
            {t("common.loading")}
          </div>
        ) : filteredGroups.length === 0 ? (
          <div className="p-6 text-center text-caption text-muted-foreground">
            {t("permissions.noResults")}
          </div>
        ) : (
          filteredGroups.map((group) => {
            const sectionLabel = group.sectionLabelKey
              ? t(group.sectionLabelKey as MessageKey)
              : null;
            return (
              <div key={group.sectionKey ?? group.modules[0]?.key}>
                {sectionLabel && (
                  <div className="bg-muted/50 px-3 py-1.5 text-caption font-medium text-muted-foreground">
                    {sectionLabel}
                  </div>
                )}
                {group.modules.map((module) => {
                  const grantedCount = module.actions.filter((a) => granted.has(a.name)).length;
                  const isAllGranted = grantedCount === module.actions.length;
                  const isSomeGranted = grantedCount > 0 && !isAllGranted;
                  const isExpanded = expanded.has(module.key);

                  return (
                    <div key={module.key} className="border-b border-border/50 last:border-b-0">
                      <div
                        className={cn(
                          "flex items-center gap-2 px-3 py-1.5 hover:bg-muted/30",
                          sectionLabel && "ps-6",
                        )}
                      >
                        {isOverrideMode ? (
                          <span className="w-4 shrink-0" />
                        ) : (
                          <Checkbox
                            checked={isAllGranted ? true : isSomeGranted ? "indeterminate" : false}
                            disabled={disabled}
                            onCheckedChange={(checked) => toggleModule(module, !!checked)}
                          />
                        )}
                        <EnterpriseButton
                          type="button"
                          variant="ghost"
                          size="inline"
                          className="flex flex-1 items-center justify-start gap-1.5 font-normal"
                          onClick={() => toggleExpanded(module.key)}
                        >
                          <ChevronDown
                            className={cn(
                              "size-3.5 shrink-0 text-muted-foreground transition-transform",
                              isExpanded && "rotate-180",
                            )}
                          />
                          {t(module.labelKey as MessageKey)}
                        </EnterpriseButton>
                        <span
                          className={cn(
                            "w-16 shrink-0 text-end text-caption tabular-nums",
                            grantedCount > 0 ? "text-foreground" : "text-muted-foreground",
                          )}
                        >
                          {grantedCount}/{module.actions.length}
                        </span>
                      </div>
                      {isExpanded && !isOverrideMode && (
                        <div
                          className={cn(
                            "flex flex-wrap gap-x-5 gap-y-2 border-t border-border/40 bg-muted/20 px-3 py-2 ps-10",
                            sectionLabel && "ps-14",
                          )}
                        >
                          {module.actions.map((action) => (
                            <label
                              key={action.name}
                              className="flex items-center gap-1.5 text-caption select-none"
                            >
                              <Checkbox
                                checked={granted.has(action.name)}
                                disabled={disabled}
                                onCheckedChange={(checked) => setPermission(action.name, !!checked)}
                              />
                              {actionLabel(action)}
                            </label>
                          ))}
                        </div>
                      )}
                      {isExpanded && isOverrideMode && (
                        <div
                          className={cn(
                            "flex flex-col divide-y divide-border/40 border-t border-border/40 bg-muted/20 ps-8",
                            sectionLabel && "ps-12",
                          )}
                        >
                          {module.actions.map((action) => (
                            <div
                              key={action.name}
                              className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-1.5 pe-3"
                            >
                              <div className="flex min-w-0 flex-wrap items-center gap-1.5 text-caption">
                                <span>{actionLabel(action)}</span>
                                <PermissionSourceChip
                                  name={action.name}
                                  inherited={inheritedSet}
                                  grants={grantSet}
                                  denies={denySet}
                                />
                              </div>
                              <ToggleGroup
                                type="single"
                                value={overrideStateOf(action.name)}
                                disabled={disabled}
                                // Radix emits "" when the pressed item is pressed again; a permission always has a source.
                                onValueChange={(next) => {
                                  if (next === "inherit" || next === "grant" || next === "deny") {
                                    setOverride(action.name, next);
                                  }
                                }}
                                aria-label={`${t("permissionTemplates.state.label")} — ${actionLabel(action)}`}
                              >
                                <ToggleGroupItem value="inherit" size="sm">
                                  {t("permissionTemplates.state.inherit")}
                                </ToggleGroupItem>
                                <ToggleGroupItem value="grant" size="sm">
                                  {t("permissionTemplates.state.grant")}
                                </ToggleGroupItem>
                                <ToggleGroupItem value="deny" size="sm">
                                  {t("permissionTemplates.state.deny")}
                                </ToggleGroupItem>
                              </ToggleGroup>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
