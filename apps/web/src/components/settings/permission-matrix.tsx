"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronsDownUp, ChevronsUpDown, Search } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { EnterpriseButton } from "@/components/ui/button";
import {
  permissionsService,
  type PermissionCatalogGroup,
  type PermissionModuleDef,
} from "@/services/permissions-service";
import { useLocale } from "@/providers/locale-provider";
import type { MessageKey } from "@/i18n/translate";
import { cn } from "@/lib/utils";

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
};

/**
 * TASK-060 Part 11 — the Permission Matrix (Daftra-style): one module per
 * row, compact, expandable, sticky header, fast search, per-module Select
 * All, global Expand/Collapse All, and a granted-count badge per row.
 * Purely controlled — `value` is the full list of granted permission names,
 * `onChange` always receives the full next list (never a delta), matching
 * `PUT /users/:id/permissions`'s own "always saves the full checked list"
 * contract.
 */
export function PermissionMatrix({
  value,
  onChange,
  disabled,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
}) {
  const { t } = useLocale();
  const [groups, setGroups] = useState<PermissionCatalogGroup[] | null>(null);
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    permissionsService
      .getCatalog()
      .then(setGroups)
      .catch(() => setGroups([]));
  }, []);

  const allModules = useMemo(() => groups?.flatMap((group) => group.modules) ?? [], [groups]);

  const granted = useMemo(() => new Set(value), [value]);

  const filteredGroups = useMemo(() => {
    if (!groups) return [];
    const query = search.trim().toLowerCase();
    if (!query) return groups;
    return groups
      .map((group) => {
        const sectionLabel = group.sectionLabelKey
          ? t(group.sectionLabelKey as MessageKey).toLowerCase()
          : "";
        if (sectionLabel.includes(query)) return group;
        const modules = group.modules.filter(
          (module) =>
            t(module.labelKey as MessageKey)
              .toLowerCase()
              .includes(query) || module.key.toLowerCase().includes(query),
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

  const setPermission = (name: string, checked: boolean) => {
    if (disabled) return;
    const next = new Set(value);
    if (checked) next.add(name);
    else next.delete(name);
    onChange([...next]);
  };

  const toggleModule = (module: PermissionModuleDef, checked: boolean) => {
    if (disabled) return;
    const next = new Set(value);
    for (const action of module.actions) {
      if (checked) next.add(action.name);
      else next.delete(action.name);
    }
    onChange([...next]);
  };

  const totalGrantedCount = value.length;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="relative w-full max-w-64">
          <Search className="pointer-events-none absolute start-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            inputSize="sm"
            className="ps-7"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t("permissions.searchPlaceholder")}
          />
        </div>
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
            <ChevronsUpDown className="size-3.5" />
            {t("permissions.expandAll")}
          </EnterpriseButton>
          <EnterpriseButton
            type="button"
            variant="ghost"
            size="sm"
            className="gap-1.5"
            onClick={collapseAll}
          >
            <ChevronsDownUp className="size-3.5" />
            {t("permissions.collapseAll")}
          </EnterpriseButton>
        </div>
      </div>

      <div className="max-h-[26rem] overflow-y-auto rounded-md border border-border">
        <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-border bg-muted/60 px-3 py-1.5 text-caption font-medium text-muted-foreground backdrop-blur-sm">
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
                        <Checkbox
                          checked={isAllGranted ? true : isSomeGranted ? "indeterminate" : false}
                          disabled={disabled}
                          onCheckedChange={(checked) => toggleModule(module, !!checked)}
                        />
                        <button
                          type="button"
                          className="flex flex-1 items-center gap-1.5 text-start text-body"
                          onClick={() => toggleExpanded(module.key)}
                        >
                          <ChevronDown
                            className={cn(
                              "size-3.5 shrink-0 text-muted-foreground transition-transform",
                              isExpanded && "rotate-180",
                            )}
                          />
                          {t(module.labelKey as MessageKey)}
                        </button>
                        <span
                          className={cn(
                            "w-16 shrink-0 text-end text-caption tabular-nums",
                            grantedCount > 0 ? "text-foreground" : "text-muted-foreground",
                          )}
                        >
                          {grantedCount}/{module.actions.length}
                        </span>
                      </div>
                      {isExpanded && (
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
                              {t(ACTION_LABEL_KEY[action.action] ?? action.action)}
                            </label>
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
