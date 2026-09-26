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
import { FilterTrigger } from "@/components/shared/data-table/filter-popover";
import { useLocale } from "@/providers/locale-provider";
import { filterByArabicSearch } from "@/lib/arabic-search";

export interface SelectFilterOption {
  value: string;
  label: string;
  searchText?: string;
}

/**
 * Single-value list filter — the sibling of `MultiSelectFilter` for a
 * dimension where only one choice makes sense (a ranking metric, a lead's
 * lifecycle stage). List pages used to reach for a bare `<Select>` here,
 * which gave the filter bar two different control heights and no way to
 * return to "all" once a value was picked.
 *
 * The empty string is the "all" state and is always offered as the first row.
 */
export function SelectFilter({
  label,
  value,
  onChange,
  options,
  allLabel,
  searchable,
  className,
  disabled,
  showAllOption = true,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: SelectFilterOption[];
  /** Row that clears the filter. Defaults to "All". */
  allLabel?: string;
  searchable?: boolean;
  className?: string;
  disabled?: boolean;
  /**
   * `false` for a required single-value switch (an import job, a view) —
   * there is no "all" state, so the list offers only real values.
   */
  showAllOption?: boolean;
}) {
  const { t } = useLocale();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const showSearch = searchable ?? options.length > 7;
  const resolvedAllLabel = allLabel ?? t("table.filterAll");

  const filtered = useMemo(
    () =>
      filterByArabicSearch(
        options,
        search,
        (option) => `${option.label} ${option.searchText ?? option.value}`,
      ),
    [options, search],
  );

  const selectedLabel = options.find((option) => option.value === value)?.label;

  const select = (next: string) => {
    onChange(next);
    setOpen(false);
    setSearch("");
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
          label={selectedLabel ?? label}
          isActive={showAllOption && Boolean(value)}
          aria-expanded={open}
          disabled={disabled}
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
              {showAllOption && !search.trim() ? (
                <CommandItem value="__all__" data-checked={!value} onSelect={() => select("")}>
                  <span className="min-w-0 flex-1 truncate text-muted-foreground">
                    {resolvedAllLabel}
                  </span>
                </CommandItem>
              ) : null}
              {filtered.map((option) => (
                <CommandItem
                  key={option.value}
                  value={option.value}
                  data-checked={value === option.value}
                  onSelect={() => select(option.value)}
                >
                  <span className="min-w-0 flex-1 truncate">{option.label}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </CommandPopoverContent>
    </Popover>
  );
}
