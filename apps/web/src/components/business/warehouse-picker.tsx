"use client";

import { useEffect, useState } from "react";
import { ChevronsUpDown, Warehouse as WarehouseIcon } from "lucide-react";
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
import { createMasterDataService } from "@/services/master-data-service";
import type { WarehouseRow } from "@/config/master-data/entities";
import { useLocale } from "@/providers/locale-provider";

const warehousesService = createMasterDataService<WarehouseRow>("/warehouses");

/**
 * Sales Foundation shared editor (TASK-039) — the ONE warehouse search/
 * select used by `ProductLineItemsGrid`'s Warehouse cell. Same combobox
 * pattern as `ProductPicker`/`CustomerPicker` — no separate visual language
 * for a third picker.
 */
export function WarehousePicker({
  value,
  onChange,
  disabled,
}: {
  value: WarehouseRow | null | undefined;
  onChange: (warehouse: WarehouseRow) => void;
  disabled?: boolean;
}) {
  const { t } = useLocale();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<WarehouseRow[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    const timeout = setTimeout(() => {
      const runSearch = async () => {
        setIsLoading(true);
        try {
          const result = await warehousesService.list({ search: search || undefined, pageSize: 8 });
          setResults(result.items.filter((w) => w.isActive));
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
          className="w-full max-w-(--width-picker-warehouse) justify-between font-normal"
        >
          <span className="flex min-w-0 items-center gap-2">
            <WarehouseIcon className="size-4 shrink-0 text-muted-foreground" />
            <span className="truncate">
              {value ? `${value.code} — ${value.name}` : t("sales.editor.grid.selectWarehouse")}
            </span>
          </span>
          <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
        </EnterpriseButton>
      </PopoverTrigger>
      <CommandPopoverContent>
        <Command shouldFilter={false}>
          <CommandInput
            placeholder={t("sales.editor.grid.warehouseSearchPlaceholder")}
            value={search}
            onValueChange={setSearch}
          />
          <CommandList>
            {!isLoading && results.length === 0 && (
              <CommandEmpty>{t("sales.customers.picker.noResults")}</CommandEmpty>
            )}
            <CommandGroup>
              {results.map((warehouse) => (
                <CommandItem
                  key={warehouse.id}
                  value={warehouse.id}
                  onSelect={() => {
                    onChange(warehouse);
                    setOpen(false);
                    setSearch("");
                  }}
                  data-checked={value?.id === warehouse.id}
                >
                  <CommandResultRow title={warehouse.name} subtitle={warehouse.code} />
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </CommandPopoverContent>
    </Popover>
  );
}
