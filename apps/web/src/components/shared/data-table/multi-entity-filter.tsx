"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Spinner } from "@/components/ui/spinner";
import { Popover, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandPopoverContent,
  CommandResultRow,
} from "@/components/ui/command";
import { FilterPopoverFooter, FilterTrigger } from "@/components/shared/data-table/filter-popover";
import { SEARCH_DEBOUNCE_MS } from "@/hooks/use-debounced-value";
import { useLocale } from "@/providers/locale-provider";

/**
 * Searchable multi-select for long entity lists (customers, suppliers,
 * products). Stays open while selecting. Form pickers stay single-select.
 */
export function MultiEntityFilter<T>({
  label,
  values,
  onChange,
  onSearch,
  getId,
  getTitle,
  getSubtitle,
  subtitleDir,
  className,
}: {
  label: string;
  values: T[];
  onChange: (values: T[]) => void;
  onSearch: (query: string) => Promise<T[]>;
  getId: (item: T) => string;
  getTitle: (item: T) => string;
  getSubtitle?: (item: T) => ReactNode;
  subtitleDir?: "ltr" | "rtl";
  className?: string;
}) {
  const { t } = useLocale();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [options, setOptions] = useState<T[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const onSearchRef = useRef(onSearch);

  useEffect(() => {
    onSearchRef.current = onSearch;
  });

  const selectedIds = useMemo(() => new Set(values.map(getId)), [values, getId]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const handle = window.setTimeout(() => {
      const run = async () => {
        setIsLoading(true);
        try {
          const items = await onSearchRef.current(search);
          if (!cancelled) setOptions(items);
        } catch {
          if (!cancelled) setOptions([]);
        } finally {
          if (!cancelled) setIsLoading(false);
        }
      };
      void run();
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [open, search]);

  const merged = useMemo(() => {
    const seen = new Set<string>();
    const rows: T[] = [];
    for (const item of [...values, ...options]) {
      const id = getId(item);
      if (seen.has(id)) continue;
      seen.add(id);
      rows.push(item);
    }
    return rows;
  }, [values, options, getId]);

  const triggerLabel = (() => {
    if (values.length === 0) return label;
    if (values.length === 1) return getTitle(values[0]!);
    return t("table.filterSelectedCount", { count: values.length });
  })();

  const toggle = (item: T) => {
    const id = getId(item);
    if (selectedIds.has(id)) {
      onChange(values.filter((value) => getId(value) !== id));
      return;
    }
    onChange([...values, item]);
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
      <CommandPopoverContent className="min-w-64">
        <Command shouldFilter={false}>
          <CommandInput
            placeholder={t("common.search")}
            value={search}
            onValueChange={setSearch}
            onClear={() => setSearch("")}
            clearLabel={t("table.clearSearch")}
          />
          <CommandList>
            {isLoading ? (
              <div className="flex items-center justify-center py-6 text-muted-foreground">
                <Spinner className="size-4 text-muted-foreground" />
              </div>
            ) : merged.length === 0 ? (
              <CommandEmpty>{t("common.noResults")}</CommandEmpty>
            ) : (
              <CommandGroup>
                {merged.map((item) => (
                  <CommandItem
                    key={getId(item)}
                    value={getId(item)}
                    data-checked={selectedIds.has(getId(item))}
                    onSelect={() => toggle(item)}
                  >
                    <CommandResultRow
                      title={getTitle(item)}
                      subtitle={getSubtitle?.(item)}
                      subtitleDir={subtitleDir}
                    />
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
          <FilterPopoverFooter
            hasSelection={values.length > 0}
            onDeselectAll={() => onChange([])}
          />
        </Command>
      </CommandPopoverContent>
    </Popover>
  );
}
