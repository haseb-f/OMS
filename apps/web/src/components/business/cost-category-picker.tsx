"use client";

import { Tag } from "lucide-react";
import { EntityCombobox } from "@/components/shared/entity-combobox";
import type { CostComponentRow } from "@/config/master-data/entities";
import { useLocale } from "@/providers/locale-provider";
import type { MessageKey } from "@/i18n/translate";

/** Only active, `capitalizable: true` categories are selectable (ADR-0017 — enforced again server-side in `assertCapitalizable`). */
export function CostCategoryPicker({
  value,
  onChange,
  items,
  disabled,
}: {
  value: CostComponentRow | null | undefined;
  onChange: (category: CostComponentRow | null) => void;
  items: CostComponentRow[];
  disabled?: boolean;
}) {
  const { t } = useLocale();
  const eligible = items.filter((item) => item.capitalizable && item.isActive && !item.deletedAt);

  return (
    <EntityCombobox
      value={value ?? null}
      onChange={onChange}
      items={eligible}
      getId={(category) => category.id}
      getTitle={(category) => category.name}
      getSearchText={(category) => `${category.code} ${category.name} ${category.nameEn ?? ""}`}
      getSubtitle={(category) =>
        t(`masterData.costAccountingClass.${category.accountingClass}` as MessageKey)
      }
      placeholder={t("common.select")}
      searchPlaceholder={t("common.search")}
      emptyText={t("common.noResults")}
      disabled={disabled}
      icon={<Tag className="size-3.5 shrink-0 text-muted-foreground" />}
    />
  );
}
