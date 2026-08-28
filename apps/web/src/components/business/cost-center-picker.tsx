"use client";

import { Building2 } from "lucide-react";
import { EntityCombobox } from "@/components/shared/entity-combobox";
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
}: {
  value: CostCenterRow | null | undefined;
  onChange: (costCenter: CostCenterRow | null) => void;
  disabled?: boolean;
  placeholder?: string;
  /** Skip the async search and filter this already-fetched list instead — for callers (e.g. a line-grid) that prefetch the cost center list once for the whole page rather than per-row. */
  items?: CostCenterRow[];
}) {
  const { t } = useLocale();

  return (
    <EntityCombobox
      value={value ?? null}
      onChange={onChange}
      items={items}
      onSearch={
        items
          ? undefined
          : async (search) => {
              const result = await costCentersService.list({
                search: search || undefined,
                pageSize: 20,
              });
              return result.items;
            }
      }
      getId={(costCenter) => costCenter.id}
      getTitle={(costCenter) => costCenter.name}
      getSearchText={(costCenter) => costCenter.code}
      getSubtitle={(costCenter) => costCenter.code}
      subtitleDir="ltr"
      placeholder={placeholder ?? t("accounting.journalEntries.lines.selectCostCenter")}
      disabled={disabled}
      allowClear
      icon={<Building2 className="size-3.5 shrink-0 text-muted-foreground" />}
    />
  );
}
