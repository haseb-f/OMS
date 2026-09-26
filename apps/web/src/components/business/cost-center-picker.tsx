"use client";

import { Building2 } from "lucide-react";
import { EntityCombobox } from "@/components/shared/entity-combobox";
import { cachedLookup } from "@/lib/lookup-cache";
import { createMasterDataService } from "@/services/master-data-service";
import type { CostCenterRow } from "@/config/master-data/entities";
import { useLocale } from "@/providers/locale-provider";

const costCentersService = createMasterDataService<CostCenterRow>("/cost-centers");

/** The one searchable Cost Center selector — mirrors `AccountPicker` exactly (same EntityCombobox architecture, same list source), used wherever a document line or header needs cost attribution. */
export function CostCenterPicker({
  value,
  onChange,
  disabled,
  placeholder,
  items,
  id,
  "aria-label": ariaLabel,
}: {
  value: CostCenterRow | null | undefined;
  onChange: (costCenter: CostCenterRow | null) => void;
  disabled?: boolean;
  placeholder?: string;
  /** Skip the async search and filter this already-fetched list instead — for callers (e.g. a line-grid) that prefetch the cost center list once for the whole page rather than per-row. */
  items?: CostCenterRow[];
  /** Forwarded to the trigger so an external `<Label htmlFor>` / `FormControl` can name it. */
  id?: string;
  "aria-label"?: string;
}) {
  const { t } = useLocale();

  return (
    <EntityCombobox
      id={id}
      triggerProps={{ "aria-label": ariaLabel }}
      value={value ?? null}
      onChange={onChange}
      items={items}
      onSearch={
        items
          ? undefined
          : async (search) => {
              const params = { search: search || undefined, pageSize: 20 };
              const result = await cachedLookup(`cost-centers:${JSON.stringify(params)}`, () =>
                costCentersService.list(params),
              );
              return result.items;
            }
      }
      getId={(costCenter) => costCenter.id}
      getTitle={(costCenter) => costCenter.name}
      getSearchText={(costCenter) => costCenter.code}
      placeholder={placeholder ?? t("accounting.journalEntries.lines.selectCostCenter")}
      disabled={disabled}
      allowClear
      icon={<Building2 className="size-3.5 shrink-0 text-muted-foreground" />}
    />
  );
}
