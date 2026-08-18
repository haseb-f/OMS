"use client";

import { useMemo, useState } from "react";
import { ChevronsUpDown } from "lucide-react";
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
import { EnterpriseButton } from "@/components/ui/button";
import { useLocale } from "@/providers/locale-provider";
import { cn } from "@/lib/utils";

export interface MultiSelectFilterOption {
  value: string;
  label: string;
  searchText?: string;
}

/**
 * Shared operational-list filter: multi-select, optional search, stays
 * open while choosing. Selection uses primary-soft — never green.
 */
export function MultiSelectFilter({
  label,
  values,
  onChange,
  options,
  searchable,
  className,
}: {
  label: string;
  values: string[];
  onChange: (values: string[]) => void;
  options: MultiSelectFilterOption[];
  searchable?: boolean;
  className?: string;
}) {
  const { t } = useLocale();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const showSearch = searchable ?? options.length > 7;
  const selected = useMemo(() => new Set(values), [values]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return options;
    return options.filter((option) => {
      const haystack = `${option.label} ${option.searchText ?? option.value}`.toLowerCase();
      return haystack.includes(needle);
    });
  }, [options, search]);

  const triggerLabel = (() => {
    if (values.length === 0) return label;
    if (values.length === 1) {
      return options.find((option) => option.value === values[0])?.label ?? label;
    }
    return t("table.filterSelectedCount", { count: values.length });
  })();

  const toggle = (value: string) => {
    if (selected.has(value)) {
      onChange(values.filter((item) => item !== value));
      return;
    }
    onChange([...values, value]);
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setSearch("");
      }}
    >
      <PopoverTrigger asChild>
        <EnterpriseButton
          type="button"
          variant="outline"
          size="sm"
          role="combobox"
          aria-expanded={open}
          aria-haspopup="listbox"
          className={cn(
            "min-w-36 justify-between font-normal",
            values.length > 0 && "border-primary/40 bg-primary-soft",
            className,
          )}
        >
          <span className="min-w-0 truncate">{triggerLabel}</span>
          <ChevronsUpDown className="size-3.5 shrink-0 opacity-50" />
        </EnterpriseButton>
      </PopoverTrigger>
      <CommandPopoverContent className="min-w-56">
        <Command shouldFilter={false}>
          {showSearch ? (
            <CommandInput
              placeholder={t("common.search")}
              value={search}
              onValueChange={setSearch}
            />
          ) : null}
          <CommandList>
            {filtered.length === 0 ? <CommandEmpty>{t("common.noResults")}</CommandEmpty> : null}
            <CommandGroup>
              {filtered.map((option) => (
                <CommandItem
                  key={option.value}
                  value={option.value}
                  data-checked={selected.has(option.value)}
                  onSelect={() => toggle(option.value)}
                >
                  <span className="min-w-0 flex-1 truncate">{option.label}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
          <CommandSeparator />
          <div className="flex items-center justify-between gap-2 px-2 py-1.5">
            <EnterpriseButton
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2"
              onClick={() => onChange(options.map((option) => option.value))}
            >
              {t("common.selectAll")}
            </EnterpriseButton>
            <EnterpriseButton
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2"
              disabled={values.length === 0}
              onClick={() => onChange([])}
            >
              {t("common.deselectAll")}
            </EnterpriseButton>
          </div>
        </Command>
      </CommandPopoverContent>
    </Popover>
  );
}
