"use client";

import { useEffect, useState } from "react";
import { Plus, Truck } from "lucide-react";
import { CommandItem } from "@/components/ui/command";
import { EntityCombobox } from "@/components/shared/entity-combobox";
import { suppliersService, type SupplierRow } from "@/services/suppliers-service";
import { useLocalStorage } from "@/hooks/use-local-storage";
import { STORAGE_KEYS } from "@/constants/storage-keys";
import { SupplierQuickCreateDialog } from "./supplier-quick-create-dialog";
import { useLocale } from "@/providers/locale-provider";

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
  const [quickCreateOpen, setQuickCreateOpen] = useState(false);
  const [recentIds, setRecentIds] = useLocalStorage<string[]>(STORAGE_KEYS.recentSuppliers, []);
  const [recentSuppliers, setRecentSuppliers] = useState<SupplierRow[]>([]);

  useEffect(() => {
    if (recentIds.length === 0) return;
    let cancelled = false;
    const loadRecent = async () => {
      const rows = await Promise.all(
        recentIds.slice(0, 5).map((id) => suppliersService.get(id).catch(() => null)),
      );
      if (!cancelled) {
        setRecentSuppliers(rows.filter((row): row is SupplierRow => !!row));
      }
    };
    void loadRecent();
    return () => {
      cancelled = true;
    };
  }, [recentIds]);

  const selectSupplier = (supplier: SupplierRow) => {
    onChange(supplier);
    setRecentIds((previous) =>
      [supplier.id, ...previous.filter((id) => id !== supplier.id)].slice(0, 5),
    );
  };

  return (
    <>
      <EntityCombobox
        value={value ?? null}
        onChange={(supplier) => {
          if (supplier) selectSupplier(supplier);
        }}
        onSearch={async (search) => {
          const result = await suppliersService.list({
            search: search || undefined,
            pageSize: 8,
          });
          return result.items;
        }}
        getId={(supplier) => supplier.id}
        getTitle={(supplier) => supplier.name}
        getSubtitle={(supplier) =>
          [supplier.supplierNumber, supplier.phone].filter(Boolean).join(" · ")
        }
        subtitleDir="ltr"
        placeholder={t("purchasing.suppliers.picker.selectSupplier")}
        searchPlaceholder={t("purchasing.suppliers.picker.placeholder")}
        emptyText={t("purchasing.suppliers.picker.noResults")}
        disabled={disabled}
        icon={<Truck className="size-4 shrink-0 text-muted-foreground" />}
        triggerClassName="max-w-(--width-picker-customer)"
        groups={
          recentIds.length > 0 && recentSuppliers.length
            ? [{ heading: t("purchasing.suppliers.picker.recent"), items: recentSuppliers }]
            : undefined
        }
        footer={
          <CommandItem value="__quick_create__" onSelect={() => setQuickCreateOpen(true)}>
            <Plus className="size-4" />
            {t("purchasing.suppliers.picker.quickCreate")}
          </CommandItem>
        }
      />
      <SupplierQuickCreateDialog
        open={quickCreateOpen}
        onOpenChange={setQuickCreateOpen}
        onCreated={selectSupplier}
      />
    </>
  );
}
