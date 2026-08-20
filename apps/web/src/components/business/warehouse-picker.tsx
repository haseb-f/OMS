"use client";

import { Warehouse as WarehouseIcon } from "lucide-react";
import { EntityCombobox } from "@/components/shared/entity-combobox";
import { createMasterDataService } from "@/services/master-data-service";
import type { WarehouseRow } from "@/config/master-data/entities";
import { useLocale } from "@/providers/locale-provider";

const warehousesService = createMasterDataService<WarehouseRow>("/warehouses");

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

  return (
    <EntityCombobox
      value={value ?? null}
      onChange={(warehouse) => {
        if (warehouse) onChange(warehouse);
      }}
      onSearch={async (search) => {
        const result = await warehousesService.list({ search: search || undefined, pageSize: 8 });
        return result.items.filter((warehouse) => warehouse.isActive);
      }}
      getId={(warehouse) => warehouse.id}
      getTitle={(warehouse) => warehouse.name}
      getSubtitle={(warehouse) => warehouse.code}
      subtitleDir="ltr"
      placeholder={t("sales.editor.grid.selectWarehouse")}
      searchPlaceholder={t("sales.editor.grid.warehouseSearchPlaceholder")}
      emptyText={t("sales.customers.picker.noResults")}
      disabled={disabled}
      icon={<WarehouseIcon className="size-3.5 shrink-0 text-muted-foreground" />}
      triggerClassName="max-w-(--width-picker-warehouse)"
    />
  );
}
