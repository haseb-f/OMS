"use client";

import { useMemo, useState } from "react";
import { Popover, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandPopoverContent,
} from "@/components/ui/command";
import { FilterPopoverFooter, FilterTrigger } from "@/components/shared/data-table/filter-popover";
import { useLocale } from "@/providers/locale-provider";
import { filterByArabicSearch } from "@/lib/arabic-search";

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

  const filtered = useMemo(
    () =>
      filterByArabicSearch(
        options,
        search,
        (option) => `${option.label} ${option.searchText ?? option.value}`,
      ),
    [options, search],
  );

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
        <FilterTrigger
          label={triggerLabel}
          isActive={values.length > 0}
          count={values.length}
          aria-expanded={open}
          className={className}
        />
      </PopoverTrigger>
      <CommandPopoverContent className="min-w-56">
        <Command shouldFilter={false}>
          {showSearch ? (
            <CommandInput
              placeholder={t("common.search")}
              value={search}
              onValueChange={setSearch}
              onClear={() => setSearch("")}
              clearLabel={t("table.clearSearch")}
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
          <FilterPopoverFooter
            hasSelection={values.length > 0}
            onSelectAll={() => onChange(options.map((option) => option.value))}
            onDeselectAll={() => onChange([])}
          />
        </Command>
      </CommandPopoverContent>
    </Popover>
  );
}
