"use client";

import { useEffect, useState } from "react";
import { Plus, UserCircle } from "lucide-react";
import { CommandItem } from "@/components/ui/command";
import { EntityCombobox } from "@/components/shared/entity-combobox";
import { customersService, type CustomerRow } from "@/services/customers-service";
import { useLocalStorage } from "@/hooks/use-local-storage";
import { STORAGE_KEYS } from "@/constants/storage-keys";
import { CustomerQuickCreateDialog } from "./customer-quick-create-dialog";
import { useLocale } from "@/providers/locale-provider";
import { cn } from "@/lib/utils";

export function CustomerPicker({
  value,
  onChange,
  disabled,
  className,
}: {
  value: CustomerRow | null | undefined;
  onChange: (customer: CustomerRow) => void;
  disabled?: boolean;
  className?: string;
}) {
  const { t } = useLocale();
  const [quickCreateOpen, setQuickCreateOpen] = useState(false);
  const [recentIds, setRecentIds] = useLocalStorage<string[]>(STORAGE_KEYS.recentCustomers, []);
  const [recentCustomers, setRecentCustomers] = useState<CustomerRow[]>([]);

  useEffect(() => {
    if (recentIds.length === 0) return;
    let cancelled = false;
    const loadRecent = async () => {
      const rows = await Promise.all(
        recentIds.slice(0, 5).map((id) => customersService.get(id).catch(() => null)),
      );
      if (!cancelled) {
        setRecentCustomers(rows.filter((row): row is CustomerRow => !!row));
      }
    };
    void loadRecent();
    return () => {
      cancelled = true;
    };
  }, [recentIds]);

  const selectCustomer = (customer: CustomerRow) => {
    onChange(customer);
    setRecentIds((previous) =>
      [customer.id, ...previous.filter((id) => id !== customer.id)].slice(0, 5),
    );
  };

  return (
    <>
      <EntityCombobox
        value={value ?? null}
        onChange={(customer) => {
          if (customer) selectCustomer(customer);
        }}
        onSearch={async (search) => {
          const result = await customersService.list({
            search: search || undefined,
            pageSize: 8,
          });
          return result.items;
        }}
        getId={(customer) => customer.id}
        getTitle={(customer) => customer.name}
        getSubtitle={(customer) => customer.phone || customer.mobile || customer.email || undefined}
        subtitleDir="ltr"
        placeholder={t("sales.customers.picker.selectCustomer")}
        searchPlaceholder={t("sales.customers.picker.placeholder")}
        emptyText={t("sales.customers.picker.noResults")}
        disabled={disabled}
        icon={<UserCircle className="size-3.5 shrink-0 text-muted-foreground" />}
        triggerClassName={cn("max-w-(--width-picker-customer)", className)}
        groups={
          recentIds.length > 0 && recentCustomers.length
            ? [{ heading: t("sales.customers.picker.recent"), items: recentCustomers }]
            : undefined
        }
        footer={
          <CommandItem value="__quick_create__" onSelect={() => setQuickCreateOpen(true)}>
            <Plus className="size-4" />
            {t("sales.customers.picker.quickCreate")}
          </CommandItem>
        }
      />
      <CustomerQuickCreateDialog
        open={quickCreateOpen}
        onOpenChange={setQuickCreateOpen}
        onCreated={selectCustomer}
      />
    </>
  );
}
