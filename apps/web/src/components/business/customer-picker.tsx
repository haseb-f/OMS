"use client";

import { useEffect, useState } from "react";
import { ChevronsUpDown, Plus, UserCircle } from "lucide-react";
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
import { customersService, type CustomerRow } from "@/services/customers-service";
import { useLocalStorage } from "@/hooks/use-local-storage";
import { STORAGE_KEYS } from "@/constants/storage-keys";
import { CustomerQuickCreateDialog } from "./customer-quick-create-dialog";
import { useLocale } from "@/providers/locale-provider";

/**
 * The ONE Customer search/select component — reused by the Customer quick
 * pick anywhere a document needs one (this task builds it as
 * standalone-reusable infrastructure; Quotation/Order/Invoice/Return wire
 * it in once those documents' own editors are built, per TASK-037's plan —
 * never re-implemented). Search hits the real `/customers?search=` endpoint
 * (code/name/phone/email, matching `CustomersService.searchFields`),
 * debounced; "Recent" reads the last 5 picked customer ids from
 * localStorage and re-fetches them by id; "+ Quick Create" opens
 * `CustomerQuickCreateDialog` inline and auto-selects the result.
 */
export function CustomerPicker({
  value,
  onChange,
  disabled,
}: {
  value: CustomerRow | null | undefined;
  onChange: (customer: CustomerRow) => void;
  disabled?: boolean;
}) {
  const { t } = useLocale();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<CustomerRow[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [quickCreateOpen, setQuickCreateOpen] = useState(false);
  const [recentIds, setRecentIds] = useLocalStorage<string[]>(STORAGE_KEYS.recentCustomers, []);
  const [recentCustomers, setRecentCustomers] = useState<CustomerRow[]>([]);

  useEffect(() => {
    if (!open) return;
    const timeout = setTimeout(() => {
      const runSearch = async () => {
        setIsLoading(true);
        try {
          const result = await customersService.list({ search: search || undefined, pageSize: 8 });
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
      setRecentCustomers([]);
      return;
    }
    const loadRecent = async () => {
      const rows = await Promise.all(
        recentIds.slice(0, 5).map((id) => customersService.get(id).catch(() => null)),
      );
      setRecentCustomers(rows.filter((row): row is CustomerRow => !!row));
    };
    void loadRecent();
  }, [open, recentIds]);

  const selectCustomer = (customer: CustomerRow) => {
    onChange(customer);
    setRecentIds((previous) =>
      [customer.id, ...previous.filter((id) => id !== customer.id)].slice(0, 5),
    );
    setOpen(false);
    setSearch("");
  };

  const showRecent = !search && recentCustomers.length > 0;

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
              <UserCircle className="size-4 shrink-0 text-muted-foreground" />
              <span className="truncate">
                {value
                  ? `${value.customerNumber} — ${value.name}`
                  : t("sales.customers.picker.selectCustomer")}
              </span>
            </span>
            <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
          </EnterpriseButton>
        </PopoverTrigger>
        <CommandPopoverContent>
          <Command shouldFilter={false}>
            <CommandInput
              placeholder={t("sales.customers.picker.placeholder")}
              value={search}
              onValueChange={setSearch}
            />
            <CommandList>
              {!isLoading && results.length === 0 && (
                <CommandEmpty>{t("sales.customers.picker.noResults")}</CommandEmpty>
              )}
              {showRecent && (
                <>
                  <CommandGroup heading={t("sales.customers.picker.recent")}>
                    {recentCustomers.map((customer) => (
                      <CommandItem
                        key={`recent-${customer.id}`}
                        value={`recent-${customer.id}`}
                        onSelect={() => selectCustomer(customer)}
                        data-checked={value?.id === customer.id}
                      >
                        <CommandResultRow
                          title={customer.name}
                          subtitle={[customer.customerNumber, customer.phone, customer.email]
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
                {results.map((customer) => (
                  <CommandItem
                    key={customer.id}
                    value={customer.id}
                    onSelect={() => selectCustomer(customer)}
                    data-checked={value?.id === customer.id}
                  >
                    <CommandResultRow
                      title={customer.name}
                      subtitle={[customer.customerNumber, customer.phone, customer.email]
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
                  {t("sales.customers.picker.quickCreate")}
                </CommandItem>
              </CommandGroup>
            </CommandList>
          </Command>
        </CommandPopoverContent>
      </Popover>
      <CustomerQuickCreateDialog
        open={quickCreateOpen}
        onOpenChange={setQuickCreateOpen}
        onCreated={selectCustomer}
      />
    </>
  );
}
