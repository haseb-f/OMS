"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ChevronsUpDown, Loader2, X } from "lucide-react";
import { Popover, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandPopoverContent,
  CommandResultRow,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { EnterpriseButton } from "@/components/ui/button";
import { useLocale } from "@/providers/locale-provider";
import { cn } from "@/lib/utils";

export type EntityComboboxGroup<T> = {
  heading: string;
  items: T[];
};

/**
 * The ONE searchable entity selector for OMS (Customer, Product, Currency,
 * Country, Account, …). Entity pickers supply identity + rendering; this
 * owns trigger, search, keyboard, loading, empty, clear, and selected state.
 */
export function EntityCombobox<T>({
  items,
  onSearch,
  value,
  onChange,
  getId,
  getTitle,
  getSubtitle,
  getSearchText,
  placeholder,
  searchPlaceholder,
  emptyText,
  disabled,
  allowClear = false,
  icon,
  error,
  groups,
  footer,
  triggerClassName,
  subtitleDir,
  id,
}: {
  items?: T[];
  onSearch?: (query: string) => Promise<T[]>;
  value: T | null | undefined;
  onChange: (value: T | null) => void;
  getId: (item: T) => string;
  getTitle: (item: T) => string;
  getSubtitle?: (item: T) => ReactNode;
  getSearchText?: (item: T) => string;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  disabled?: boolean;
  allowClear?: boolean;
  icon?: ReactNode;
  error?: boolean;
  groups?: EntityComboboxGroup<T>[];
  footer?: ReactNode;
  triggerClassName?: string;
  subtitleDir?: "ltr" | "rtl";
  id?: string;
}) {
  const { t } = useLocale();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [remoteItems, setRemoteItems] = useState<T[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const onSearchRef = useRef(onSearch);
  const isAsync = typeof onSearch === "function";

  useEffect(() => {
    onSearchRef.current = onSearch;
  });

  useEffect(() => {
    if (!open || !isAsync) return;
    const timeout = setTimeout(() => {
      const run = async () => {
        const searchFn = onSearchRef.current;
        if (!searchFn) return;
        setIsLoading(true);
        try {
          setRemoteItems(await searchFn(search));
        } catch {
          setRemoteItems([]);
        } finally {
          setIsLoading(false);
        }
      };
      void run();
    }, 200);
    return () => clearTimeout(timeout);
  }, [open, search, isAsync]);

  const filteredItems = useMemo(() => {
    const sourceItems = isAsync ? remoteItems : (items ?? []);
    if (isAsync) return sourceItems;
    const needle = search.trim().toLowerCase();
    if (!needle) return sourceItems;
    return sourceItems.filter((item) => {
      const haystack = `${getTitle(item)} ${getSearchText?.(item) ?? ""}`.toLowerCase();
      return haystack.includes(needle);
    });
  }, [isAsync, remoteItems, items, search, getTitle, getSearchText]);

  const showGroups = !search.trim() && !!groups?.length;
  const selectedId = value ? getId(value) : null;

  const select = (item: T) => {
    onChange(item);
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
      <div className="flex w-full items-center gap-1">
        <PopoverTrigger asChild>
          <EnterpriseButton
            id={id}
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            aria-haspopup="listbox"
            aria-autocomplete="list"
            aria-invalid={error || undefined}
            disabled={disabled}
            className={cn("w-full justify-between font-normal", triggerClassName)}
          >
            <span className="flex min-w-0 items-center gap-2">
              {icon}
              <span className="min-w-0 truncate">
                {value ? getTitle(value) : (placeholder ?? t("common.select"))}
              </span>
            </span>
            {isLoading ? (
              <Loader2 className="size-3.5 shrink-0 animate-spin text-muted-foreground motion-reduce:animate-none" />
            ) : (
              <ChevronsUpDown className="size-3.5 shrink-0 opacity-50" />
            )}
          </EnterpriseButton>
        </PopoverTrigger>
        {allowClear && value && !disabled ? (
          <EnterpriseButton
            type="button"
            variant="ghost"
            size="icon-sm"
            className="size-8 shrink-0"
            aria-label={t("common.clearSelection")}
            onClick={() => onChange(null)}
          >
            <X className="size-3.5 text-muted-foreground" />
          </EnterpriseButton>
        ) : null}
      </div>
      <CommandPopoverContent>
        <Command shouldFilter={false}>
          <CommandInput
            placeholder={searchPlaceholder ?? t("common.search")}
            value={search}
            onValueChange={setSearch}
          />
          <CommandList aria-busy={isLoading || undefined}>
            {isLoading ? (
              <div className="px-2.5 py-4 text-center text-caption text-muted-foreground">
                {t("common.loading")}
              </div>
            ) : (
              <>
                {!showGroups && filteredItems.length === 0 && (
                  <CommandEmpty>{emptyText ?? t("common.noResults")}</CommandEmpty>
                )}
                {showGroups &&
                  groups!.map((group) => (
                    <CommandGroup key={group.heading} heading={group.heading}>
                      {group.items.map((item) => (
                        <CommandItem
                          key={`${group.heading}-${getId(item)}`}
                          value={`${group.heading}-${getId(item)}`}
                          onSelect={() => select(item)}
                          data-checked={selectedId === getId(item)}
                        >
                          <CommandResultRow
                            title={getTitle(item)}
                            subtitle={getSubtitle?.(item)}
                            subtitleDir={subtitleDir}
                          />
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  ))}
                {showGroups && filteredItems.length > 0 ? <CommandSeparator /> : null}
                {filteredItems.length > 0 ? (
                  <CommandGroup>
                    {filteredItems.map((item) => (
                      <CommandItem
                        key={getId(item)}
                        value={getId(item)}
                        onSelect={() => select(item)}
                        data-checked={selectedId === getId(item)}
                      >
                        <CommandResultRow
                          title={getTitle(item)}
                          subtitle={getSubtitle?.(item)}
                          subtitleDir={subtitleDir}
                        />
                      </CommandItem>
                    ))}
                  </CommandGroup>
                ) : null}
              </>
            )}
            {footer ? (
              <>
                <CommandSeparator />
                <CommandGroup>{footer}</CommandGroup>
              </>
            ) : null}
          </CommandList>
        </Command>
      </CommandPopoverContent>
    </Popover>
  );
}
