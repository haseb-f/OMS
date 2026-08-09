"use client";

import { useEffect, useState } from "react";
import { ChevronsUpDown, Package } from "lucide-react";
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
} from "@/components/ui/command";
import { EnterpriseButton } from "@/components/ui/button";
import { productsService, type ProductRow } from "@/services/products-service";
import { useLocale } from "@/providers/locale-provider";

/**
 * Sales Foundation shared editor (TASK-039) — the ONE product search/select
 * used by `ProductLineItemsGrid`'s Product cell. Search hits the real
 * `/products?search=` endpoint, which already matches SKU/Name/Barcode/
 * InternalName/DisplayName/SearchKeywords server-side — no client-side
 * fuzzy matching duplicated here.
 */
export function ProductPicker({
  value,
  onChange,
  disabled,
  autoOpen,
}: {
  value: ProductRow | null | undefined;
  onChange: (product: ProductRow) => void;
  disabled?: boolean;
  autoOpen?: boolean;
}) {
  const { t } = useLocale();
  const [open, setOpen] = useState(!!autoOpen);
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<ProductRow[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    const timeout = setTimeout(() => {
      const runSearch = async () => {
        setIsLoading(true);
        try {
          const result = await productsService.list({
            search: search || undefined,
            pageSize: 8,
            status: "ACTIVE",
          });
          setResults(result.items);
        } catch {
          setResults([]);
        } finally {
          setIsLoading(false);
        }
      };
      void runSearch();
    }, 200);
    return () => clearTimeout(timeout);
  }, [search, open]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <EnterpriseButton
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className="w-full max-w-(--width-picker-product) justify-between font-normal"
        >
          <span className="flex min-w-0 items-center gap-2">
            <Package className="size-4 shrink-0 text-muted-foreground" />
            <span className="truncate">
              {value ? value.displayName || value.name : t("sales.editor.grid.selectProduct")}
            </span>
          </span>
          <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
        </EnterpriseButton>
      </PopoverTrigger>
      <CommandPopoverContent>
        <Command shouldFilter={false}>
          <CommandInput
            placeholder={t("sales.editor.grid.productSearchPlaceholder")}
            value={search}
            onValueChange={setSearch}
          />
          <CommandList>
            {!isLoading && results.length === 0 && (
              <CommandEmpty>{t("sales.customers.picker.noResults")}</CommandEmpty>
            )}
            <CommandGroup>
              {results.map((product) => (
                <CommandItem
                  key={product.id}
                  value={product.id}
                  onSelect={() => {
                    onChange(product);
                    setOpen(false);
                    setSearch("");
                  }}
                  data-checked={value?.id === product.id}
                >
                  <CommandResultRow
                    title={product.displayName || product.name}
                    subtitle={[product.sku, product.barcode].filter(Boolean).join(" · ")}
                  />
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </CommandPopoverContent>
    </Popover>
  );
}
