"use client";

import { useEffect, useState } from "react";
import { ChevronsUpDown, Plus, Truck } from "lucide-react";
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
import { suppliersService, type SupplierRow } from "@/services/suppliers-service";
import { useLocalStorage } from "@/hooks/use-local-storage";
import { STORAGE_KEYS } from "@/constants/storage-keys";
import { SupplierQuickCreateDialog } from "./supplier-quick-create-dialog";
import { useLocale } from "@/providers/locale-provider";

/**
 * The ONE Supplier search/select component (TASK-048) — mirrors
 * `CustomerPicker` exactly. Search hits `/suppliers?search=` (code/name/
 * commercial name, matching `SuppliersService.findAll`'s search fields),
 * debounced; "Recent" reads the last 5 picked supplier ids from
 * localStorage; "+ Quick Create" opens `SupplierQuickCreateDialog` inline
 * and auto-selects the result.
 */
export function SupplierPicker({
  value,
  onChange,
  disabled,
}: {
  value: SupplierRow | null | undefined;
  onChange: (supplier: SupplierRow) => void;
  disabled?: boolean;
}) {
  const { t } = useLocale();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<SupplierRow[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [quickCreateOpen, setQuickCreateOpen] = useState(false);
  const [recentIds, setRecentIds] = useLocalStorage<string[]>(STORAGE_KEYS.recentSuppliers, []);
  const [recentSuppliers, setRecentSuppliers] = useState<SupplierRow[]>([]);

  useEffect(() => {
    if (!open) return;
    const timeout = setTimeout(() => {
      const runSearch = async () => {
        setIsLoading(true);
        try {
          const result = await suppliersService.list({ search: search || undefined, pageSize: 8 });
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

  useEffect(() => {
    if (!open || recentIds.length === 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setRecentSuppliers([]);
      return;
    }
    const loadRecent = async () => {
      const rows = await Promise.all(
        recentIds.slice(0, 5).map((id) => suppliersService.get(id).catch(() => null)),
      );
      setRecentSuppliers(rows.filter((row): row is SupplierRow => !!row));
    };
    void loadRecent();
  }, [open, recentIds]);

  const selectSupplier = (supplier: SupplierRow) => {
    onChange(supplier);
    setRecentIds((previous) =>
      [supplier.id, ...previous.filter((id) => id !== supplier.id)].slice(0, 5),
    );
    setOpen(false);
    setSearch("");
  };

  const showRecent = !search && recentSuppliers.length > 0;

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <EnterpriseButton
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            disabled={disabled}
            className="w-full max-w-(--width-picker-customer) justify-between font-normal"
          >
            <span className="flex min-w-0 items-center gap-2">
              <Truck className="size-4 shrink-0 text-muted-foreground" />
              <span className="truncate">
                {value
                  ? `${value.supplierNumber} — ${value.name}`
                  : t("purchasing.suppliers.picker.selectSupplier")}
              </span>
            </span>
            <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
          </EnterpriseButton>
        </PopoverTrigger>
        <CommandPopoverContent>
          <Command shouldFilter={false}>
            <CommandInput
              placeholder={t("purchasing.suppliers.picker.placeholder")}
              value={search}
              onValueChange={setSearch}
            />
            <CommandList>
              {!isLoading && results.length === 0 && (
                <CommandEmpty>{t("purchasing.suppliers.picker.noResults")}</CommandEmpty>
              )}
              {showRecent && (
                <>
                  <CommandGroup heading={t("purchasing.suppliers.picker.recent")}>
                    {recentSuppliers.map((supplier) => (
                      <CommandItem
                        key={`recent-${supplier.id}`}
                        value={`recent-${supplier.id}`}
                        onSelect={() => selectSupplier(supplier)}
                        data-checked={value?.id === supplier.id}
                      >
                        <CommandResultRow
                          title={supplier.name}
                          subtitle={[supplier.supplierNumber, supplier.phone, supplier.email]
                            .filter(Boolean)
                            .join(" · ")}
                        />
                      </CommandItem>
                    ))}
                  </CommandGroup>
                  <CommandSeparator />
                </>
              )}
              <CommandGroup>
                {results.map((supplier) => (
                  <CommandItem
                    key={supplier.id}
                    value={supplier.id}
                    onSelect={() => selectSupplier(supplier)}
                    data-checked={value?.id === supplier.id}
                  >
                    <CommandResultRow
                      title={supplier.name}
                      subtitle={[supplier.supplierNumber, supplier.phone, supplier.email]
                        .filter(Boolean)
                        .join(" · ")}
                    />
                  </CommandItem>
                ))}
              </CommandGroup>
              <CommandSeparator />
              <CommandGroup>
                <CommandItem
                  value="__quick_create__"
                  onSelect={() => {
                    setOpen(false);
                    setQuickCreateOpen(true);
                  }}
                >
                  <Plus className="size-4" />
                  {t("purchasing.suppliers.picker.quickCreate")}
                </CommandItem>
              </CommandGroup>
            </CommandList>
          </Command>
        </CommandPopoverContent>
      </Popover>
      <SupplierQuickCreateDialog
        open={quickCreateOpen}
        onOpenChange={setQuickCreateOpen}
        onCreated={selectSupplier}
      />
    </>
  );
}
