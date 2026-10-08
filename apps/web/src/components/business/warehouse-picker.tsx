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

type WarehouseRole = NonNullable<WarehouseRow["role"]>;
const STOCK_ONLY: readonly WarehouseRole[] = ["STOCK"];
/** Documents that take goods out (write-off adjustment, transfer source) may use the damaged-goods warehouse. */
export const WRITE_OFF_ROLES: readonly WarehouseRole[] = ["STOCK", "DAMAGED"];

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
  roles = STOCK_ONLY,
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
  /**
   * R15 (review M3) — the warehouse roles offered. Stock warehouses only by
   * default: goods in transit are moved by the order lifecycle alone, and a
   * manual document may only take goods out of the damaged-goods warehouse
   * (adjustment / transfer source pass `["STOCK", "DAMAGED"]`).
   */
  roles?: readonly WarehouseRole[];
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
        return result.items.filter(
          (warehouse) => warehouse.isActive && roles.includes(warehouse.role ?? "STOCK"),
        );
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
