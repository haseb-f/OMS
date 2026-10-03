"use client";

import { TriggerChevron } from "@/components/ui/trigger-chevron";
import { Fragment, useEffect, useId, useRef, useState } from "react";
import { LayoutList } from "lucide-react";
import { EnterpriseButton } from "@/components/ui/button";
import { Popover, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandPopoverContent,
  CommandSeparator,
} from "@/components/ui/command";
import { useLocale } from "@/providers/locale-provider";

export interface ReportSwitcherOption {
  value: string;
  label: string;
  /** Group heading (already translated). Consecutive options with the same group form one group. */
  group?: string;
}

export interface ReportSwitcherGroup {
  heading?: string;
  items: ReportSwitcherOption[];
}

/**
 * Pure grouping (unit-tested): consecutive options sharing a `group` form one
 * group, in the caller's order. Headings are labels only — never options.
 */
export function groupReportOptions(options: ReportSwitcherOption[]): ReportSwitcherGroup[] {
  const groups: ReportSwitcherGroup[] = [];
  for (const option of options) {
    const last = groups[groups.length - 1];
    if (last && last.heading === option.group) last.items.push(option);
    else groups.push({ heading: option.group, items: [option] });
  }
  return groups;
}

/**
 * Switches to another report of the same family (usability-financial-reports
 * §3). The menu reads as a hierarchy: the family title (root, not selectable)
 * → compact group headings (not selectable) → indented report rows. The
 * active report carries the trailing check, the selected surface and
 * `aria-current`, is the initially highlighted row and is scrolled into view
 * on open. Built on the shared `Command` primitive: arrow keys / Home / End,
 * Enter, Esc (Radix popover), and type-to-filter through the search field.
 * The trigger never repeats the current report's name (the h1 already says it).
 */
export function ReportSwitcher({
  value,
  options,
  onChange,
  title,
}: {
  value: string;
  options: ReportSwitcherOption[];
  onChange: (value: string) => void;
  /** Root heading of the menu, e.g. «التقارير المالية / Financial reports». */
  title?: string;
}) {
  const { t } = useLocale();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const groups = groupReportOptions(options);
  const label = t("reports.finance.header.switchReport");

  // Reveal the active report when the menu opens (long lists / short screens).
  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => {
      const active = listRef.current?.querySelector<HTMLElement>('[data-checked="true"]');
      active?.scrollIntoView?.({ block: "nearest" });
    });
    return () => cancelAnimationFrame(frame);
  }, [open]);

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery("");
      }}
    >
      <PopoverTrigger asChild>
        <EnterpriseButton
          type="button"
          variant="menu"
          aria-label={label}
          aria-haspopup="dialog"
          className="max-md:size-(--control-height-md) max-md:px-0"
        >
          <LayoutList data-icon="inline-start" />
          <span className="max-md:sr-only">{label}</span>
          <TriggerChevron className="max-md:hidden" />
        </EnterpriseButton>
      </PopoverTrigger>
      <CommandPopoverContent align="end" className="min-w-64">
        <Command defaultValue={value} label={title ?? label} loop>
          {title ? (
            <div
              id={titleId}
              data-slot="report-switcher-title"
              className="border-b border-border px-2.5 pt-1 pb-2 text-body font-semibold text-foreground"
            >
              {title}
            </div>
          ) : null}
          <CommandInput
            value={query}
            onValueChange={setQuery}
            placeholder={t("pickers.option.search")}
            aria-describedby={title ? titleId : undefined}
            onClear={() => setQuery("")}
            clearLabel={t("common.clearSelection")}
          />
          <CommandList
            ref={listRef}
            className="max-h-[min(26rem,calc(var(--radix-popover-content-available-height,100dvh)-6rem))]"
          >
            <CommandEmpty>{t("common.noResults")}</CommandEmpty>
            {groups.map((group, index) => (
              <Fragment key={group.heading ?? `group-${index}`}>
                {index > 0 && group.heading ? <CommandSeparator className="mx-1" /> : null}
                <CommandGroup
                  heading={group.heading}
                  data-report-group={group.heading ?? ""}
                  className="py-0.5 **:[[cmdk-group-heading]]:ps-2.5 **:[[cmdk-group-heading]]:pt-1.5 **:[[cmdk-group-heading]]:pb-1 **:[[cmdk-group-heading]]:font-semibold"
                >
                  {group.items.map((option) => {
                    const active = option.value === value;
                    return (
                      <CommandItem
                        key={option.value}
                        value={option.value}
                        keywords={[option.label]}
                        data-checked={active}
                        aria-current={active ? "true" : undefined}
                        className={
                          group.heading
                            ? "ps-5 data-[checked=true]:font-medium"
                            : "data-[checked=true]:font-medium"
                        }
                        onSelect={() => {
                          onChange(option.value);
                          setOpen(false);
                          setQuery("");
                        }}
                      >
                        <span className="min-w-0 flex-1 truncate">{option.label}</span>
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              </Fragment>
            ))}
          </CommandList>
        </Command>
      </CommandPopoverContent>
    </Popover>
  );
}
