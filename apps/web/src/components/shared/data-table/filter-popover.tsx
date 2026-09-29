"use client";

import { forwardRef, type ComponentProps } from "react";

import { EnterpriseButton } from "@/components/ui/button";
import { EnterpriseBadge } from "@/components/ui/badge";
import { TriggerChevron } from "@/components/ui/trigger-chevron";
import { CommandSeparator } from "@/components/ui/command";
import { useLocale } from "@/providers/locale-provider";
import { cn } from "@/lib/utils";

/**
 * The shared chrome behind every list filter popover (`MultiSelectFilter`,
 * `MultiEntityFilter`, `SelectFilter`). Only the option source differs
 * between them — static enum, async entity search, single value — so the
 * trigger and the footer live here once and every filter in a bar is
 * guaranteed the same height, active tint and reset affordance.
 */
export const FilterTrigger = forwardRef<
  HTMLButtonElement,
  ComponentProps<typeof EnterpriseButton> & {
    label: string;
    isActive?: boolean;
    count?: number;
    /** `menu` for a trigger that opens more controls (e.g. "More filters"), not a value list. */
    chevron?: "select" | "menu";
  }
>(function FilterTrigger({ label, isActive, count, chevron = "select", className, ...props }, ref) {
  return (
    <EnterpriseButton
      ref={ref}
      type="button"
      variant="field"
      size="sm"
      role="combobox"
      aria-haspopup="listbox"
      data-filter-trigger=""
      data-active={isActive || undefined}
      className={cn(
        "h-(--control-height-md) min-w-36 justify-between",
        // An applied filter reads as "selected": brand-tinted.
        isActive &&
          "bg-primary-soft text-primary shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--primary)_35%,transparent)] not-disabled:hover:bg-primary-soft [&_svg]:text-primary",
        className,
      )}
      {...props}
    >
      <span className="min-w-0 truncate">{label}</span>
      {count && count > 0 ? (
        <EnterpriseBadge variant="secondary" className="h-4 min-w-4 px-1 tabular-nums">
          {count}
        </EnterpriseBadge>
      ) : null}
      <TriggerChevron kind={chevron} />
    </EnterpriseButton>
  );
});

/**
 * Select-all / clear row pinned under a filter's option list. `onSelectAll`
 * is omitted for filters where "everything" isn't a meaningful selection
 * (an async entity list never has a knowable full set).
 */
export function FilterPopoverFooter({
  onSelectAll,
  onDeselectAll,
  hasSelection,
}: {
  onSelectAll?: () => void;
  onDeselectAll: () => void;
  hasSelection: boolean;
}) {
  const { t } = useLocale();

  return (
    <>
      <CommandSeparator />
      <div
        className={cn(
          "flex items-center gap-2 px-2 py-1.5",
          onSelectAll ? "justify-between" : "justify-end",
        )}
      >
        {onSelectAll ? (
          <EnterpriseButton type="button" variant="ghost" size="xs" onClick={onSelectAll}>
            {t("common.selectAll")}
          </EnterpriseButton>
        ) : null}
        <EnterpriseButton
          type="button"
          variant="ghost"
          size="xs"
          disabled={!hasSelection}
          onClick={onDeselectAll}
        >
          {t("common.deselectAll")}
        </EnterpriseButton>
      </div>
    </>
  );
}
