"use client";

import { Building2 } from "lucide-react";
import { EntityCombobox } from "@/components/shared/entity-combobox";
import { useDepartments } from "@/hooks/use-reference-data";
import type { DepartmentRow } from "@/config/master-data/entities";
import { useLocale } from "@/providers/locale-provider";

export function DepartmentPicker({
  value,
  onChange,
  disabled,
  placeholder,
  items,
  allowClear = false,
  requiredArchived,
}: {
  value: DepartmentRow | null | undefined;
  onChange: (department: DepartmentRow | null) => void;
  disabled?: boolean;
  placeholder?: string;
  /** Prefetched list — avoid a Department request per row. */
  items?: DepartmentRow[];
  allowClear?: boolean;
  /**
   * Current archived Department still shown on edit, but not offered for
   * new assignment unless it is already selected.
   */
  requiredArchived?: DepartmentRow | null;
}) {
  const { t, locale } = useLocale();
  const cached = useDepartments();
  const source = items ?? cached;
  const extra = requiredArchived && requiredArchived.deletedAt ? [requiredArchived] : [];
  const merged = [...extra.filter((row) => !source.some((item) => item.id === row.id)), ...source];

  const labelOf = (department: DepartmentRow) =>
    locale === "en" && department.nameEn ? department.nameEn : department.name;

  return (
    <EntityCombobox
      value={value ?? null}
      onChange={onChange}
      items={merged}
      getId={(department) => department.id}
      getTitle={(department) =>
        department.deletedAt
          ? `${labelOf(department)} (${t("common.archived")})`
          : labelOf(department)
      }
      getSubtitle={(department) => department.code}
      getSearchText={(department) =>
        `${department.code} ${department.name} ${department.nameEn ?? ""}`
      }
      subtitleDir="ltr"
      placeholder={placeholder ?? t("masterData.departments.select")}
      disabled={disabled}
      allowClear={allowClear}
      icon={<Building2 className="size-3.5 shrink-0 text-muted-foreground" />}
    />
  );
}
