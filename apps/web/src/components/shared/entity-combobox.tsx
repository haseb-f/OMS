"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ReactNode,
} from "react";
import { ChevronDown, X } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
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
import { SEARCH_DEBOUNCE_MS } from "@/hooks/use-debounced-value";
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
  getIcon,
  rowLayout,
  placeholder,
  searchPlaceholder,
  emptyText,
  noMatchText,
  loadingText,
  errorText,
  disabled,
  allowClear = false,
  icon,
  error,
  groups,
  footer,
  triggerClassName,
  triggerProps,
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
  /** Per-option leading glyph (a country flag, a type marker) — not an ID. */
  getIcon?: (item: T) => ReactNode;
  /** `"inline"` keeps title and metadata on one line for short pairs like a country and its calling code. */
  rowLayout?: "stacked" | "inline";
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  noMatchText?: string;
  loadingText?: string;
  errorText?: string;
  disabled?: boolean;
  allowClear?: boolean;
  icon?: ReactNode;
  error?: boolean;
  groups?: EntityComboboxGroup<T>[];
  footer?: ReactNode;
  triggerClassName?: string;
  triggerProps?: ButtonHTMLAttributes<HTMLButtonElement>;
  subtitleDir?: "ltr" | "rtl";
  id?: string;
}) {
  const { t } = useLocale();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [remoteItems, setRemoteItems] = useState<T[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const onSearchRef = useRef(onSearch);
  const isAsync = typeof onSearch === "function";
  // Guards against a slower earlier keystroke's response landing after a
  // faster later one and overwriting it with stale results.
  const searchSeqRef = useRef(0);

  useEffect(() => {
    onSearchRef.current = onSearch;
  });

  useEffect(() => {
    if (!open || !isAsync) return;
    const timeout = setTimeout(() => {
      const seq = ++searchSeqRef.current;
      const run = async () => {
        const searchFn = onSearchRef.current;
        if (!searchFn) return;
        setIsLoading(true);
        setLoadError(false);
        try {
          const results = await searchFn(search);
          if (seq !== searchSeqRef.current) return;
          setRemoteItems(results);
        } catch {
          if (seq !== searchSeqRef.current) return;
          setRemoteItems([]);
          setLoadError(true);
        } finally {
          if (seq === searchSeqRef.current) setIsLoading(false);
        }
      };
      void run();
    }, SEARCH_DEBOUNCE_MS);
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

  const emptyMessage =
    loadError && errorText
      ? errorText
      : search.trim()
        ? (noMatchText ?? emptyText ?? t("common.noResults"))
        : (emptyText ?? t("common.noResults"));

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setSearch("");
          setLoadError(false);
        }
      }}
      modal={false}
    >
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
          size="sm"
          {...triggerProps}
          className={cn(
            "h-(--control-height-sm) min-w-0 w-full justify-between text-body font-normal",
            triggerClassName,
            triggerProps?.className,
          )}
        >
          <span className="flex min-w-0 items-center gap-2">
            {icon}
            <span className="min-w-0 truncate text-start">
              {value ? getTitle(value) : (placeholder ?? t("common.select"))}
            </span>
          </span>
          <span className="flex shrink-0 items-center gap-0.5">
            {allowClear && value && !disabled ? (
              <span
                role="button"
                tabIndex={0}
                aria-label={t("common.clearSelection")}
                className="rounded-xs p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                onPointerDown={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                }}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  onChange(null);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    event.stopPropagation();
                    onChange(null);
                  }
                }}
              >
                <X className="size-3.5" />
              </span>
            ) : null}
            {isLoading ? (
              <Spinner className="size-3.5 text-muted-foreground" />
            ) : (
              <ChevronDown className="size-3.5 text-muted-foreground" />
            )}
          </span>
        </EnterpriseButton>
      </PopoverTrigger>
      <CommandPopoverContent>
        <Command shouldFilter={false}>
          <CommandInput
            placeholder={searchPlaceholder ?? t("common.search")}
            value={search}
            onValueChange={setSearch}
            onClear={() => setSearch("")}
            clearLabel={t("table.clearSearch")}
          />
          <CommandList aria-busy={isLoading || undefined}>
            {isLoading ? (
              <div className="px-2.5 py-2.5 text-center text-caption text-muted-foreground">
                {loadingText ?? t("common.loading")}
              </div>
            ) : (
              <>
                {!showGroups && filteredItems.length === 0 && (
                  <CommandEmpty>{emptyMessage}</CommandEmpty>
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
                            icon={getIcon?.(item)}
                            title={getTitle(item)}
                            subtitle={getSubtitle?.(item)}
                            subtitleDir={subtitleDir}
                            layout={rowLayout}
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
                          icon={getIcon?.(item)}
                          title={getTitle(item)}
                          subtitle={getSubtitle?.(item)}
                          subtitleDir={subtitleDir}
                          layout={rowLayout}
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
