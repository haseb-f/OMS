"use client";

import type { ButtonHTMLAttributes } from "react";
import { Warehouse as WarehouseIcon } from "lucide-react";
import { EntityCombobox } from "@/components/shared/entity-combobox";
import { cachedLookup } from "@/lib/lookup-cache";
import { createMasterDataService } from "@/services/master-data-service";
import type { WarehouseRow } from "@/config/master-data/entities";
import { useLocale } from "@/providers/locale-provider";
import { cn } from "@/lib/utils";

const warehousesService = createMasterDataService<WarehouseRow>("/warehouses");

export function WarehousePicker({
  value,
  onChange,
  disabled,
  embedded = false,
  error,
  triggerProps,
  className,
  id,
  "aria-label": ariaLabel,
}: {
  value: WarehouseRow | null | undefined;
  onChange: (warehouse: WarehouseRow) => void;
  disabled?: boolean;
  embedded?: boolean;
  error?: boolean;
  triggerProps?: ButtonHTMLAttributes<HTMLButtonElement>;
  className?: string;
  /** Forwarded to the trigger so an external `<Label htmlFor>` / `FormControl` can name it. */
  id?: string;
  "aria-label"?: string;
}) {
  const { t } = useLocale();

  return (
    <EntityCombobox
      id={id}
      value={value ?? null}
      onChange={(warehouse) => {
        if (warehouse) onChange(warehouse);
      }}
      onSearch={async (search) => {
        const params = { search: search || undefined, pageSize: 25 };
        const result = await cachedLookup(`warehouses:${JSON.stringify(params)}`, () =>
          warehousesService.list(params),
        );
        return result.items.filter((warehouse) => warehouse.isActive);
      }}
      getId={(warehouse) => warehouse.id}
      getTitle={(warehouse) => warehouse.name}
      getSubtitle={(warehouse) => warehouse.code}
      getSearchText={(warehouse) => `${warehouse.code} ${warehouse.name}`}
      placeholder={t("sales.editor.grid.selectWarehouse")}
      searchPlaceholder={t("sales.editor.grid.warehouseSearchPlaceholder")}
      emptyText={t("sales.customers.picker.noResults")}
      disabled={disabled}
      error={error}
      icon={<WarehouseIcon className="size-3.5 shrink-0 text-muted-foreground" />}
      triggerProps={{ "aria-label": ariaLabel, ...triggerProps }}
      triggerClassName={cn(!embedded && "max-w-(--width-picker-warehouse)", className)}
    />
  );
}
