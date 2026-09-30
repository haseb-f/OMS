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
 *
 * Round 5 (design-system §12.12): an unset filter shows its name; a set one
 * reads "Name: Value" — the name muted, the value in full weight (500) — so
 * the bar says what each filter is AND what it is set to. Several values
 * show the name plus a count badge. The name never truncates; a long value
 * does (full text in `title`).
 */
export const FilterTrigger = forwardRef<
  HTMLButtonElement,
  ComponentProps<typeof EnterpriseButton> & {
    /** The filter's name ("Status"), or the whole text when there is no `value`. */
    label: string;
    /** The chosen value's text ("Active"); omit while unset or when several are chosen. */
    value?: string;
    isActive?: boolean;
    count?: number;
    /** `menu` for a trigger that opens more controls (e.g. "More filters"), not a value list. */
    chevron?: "select" | "menu";
  }
>(function FilterTrigger(
  { label, value, isActive, count, chevron = "select", className, title, ...props },
  ref,
) {
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
      title={title ?? (value ? `${label}: ${value}` : undefined)}
      className={cn(
        "h-(--control-height-md) max-w-72 min-w-36 justify-between",
        // An applied filter reads as "selected": brand-tinted.
        isActive &&
          "bg-primary-soft text-primary shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--primary)_35%,transparent)] not-disabled:hover:bg-primary-soft [&_svg]:text-primary",
        className,
      )}
      {...props}
    >
      {value ? (
        <span className="flex min-w-0 flex-1 items-baseline gap-1 text-start">
          <span data-slot="filter-label" className="shrink-0 font-normal text-muted-foreground">
            {label}:
          </span>
          <span data-slot="filter-value" className="min-w-0 truncate">
            {value}
          </span>
        </span>
      ) : (
        <span className="min-w-0 flex-1 truncate text-start">{label}</span>
      )}
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
