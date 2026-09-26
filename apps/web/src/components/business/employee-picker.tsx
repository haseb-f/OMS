"use client";

import { UserRound } from "lucide-react";
import { EntityCombobox } from "@/components/shared/entity-combobox";
import { employeesService, type EmployeeRow } from "@/services/employees-service";
import { cachedLookup } from "@/lib/lookup-cache";
import { useLocale } from "@/providers/locale-provider";

type EmployeeLike = Pick<EmployeeRow, "id" | "name"> & Partial<Pick<EmployeeRow, "employeeCode">>;

/**
 * The one employee selector (KPI, targets, commissions, leads, manager
 * fields). Remote search through the employee list endpoint, debounced by
 * `EntityCombobox` and shared across every open picker via `cachedLookup`.
 * Pass `items` to filter an already-scoped list (e.g. eligible assignees)
 * locally instead.
 */
export function EmployeePicker<T extends EmployeeLike = EmployeeRow>({
  value,
  onChange,
  items,
  disabled,
  allowClear = false,
  error,
  placeholder,
  excludeIds,
  className,
  id,
  "aria-label": ariaLabel,
}: {
  value: T | null | undefined;
  onChange: (employee: T | null) => void;
  /** Local list mode — no remote search. */
  items?: T[];
  disabled?: boolean;
  allowClear?: boolean;
  error?: boolean;
  placeholder?: string;
  excludeIds?: string[];
  className?: string;
  id?: string;
  "aria-label"?: string;
}) {
  const { t } = useLocale();
  const excluded = new Set(excludeIds ?? []);

  return (
    <EntityCombobox<T>
      id={id}
      value={value ?? null}
      onChange={onChange}
      items={items?.filter((row) => !excluded.has(row.id))}
      onSearch={
        items
          ? undefined
          : async (search) => {
              const rows = await cachedLookup(`employees:search:${search}`, () =>
                employeesService.search(search),
              );
              return (rows as unknown as T[]).filter((row) => !excluded.has(row.id));
            }
      }
      getId={(employee) => employee.id}
      getTitle={(employee) => employee.name}
      getSubtitle={(employee) => employee.employeeCode}
      getSearchText={(employee) => employee.employeeCode ?? ""}
      subtitleDir="ltr"
      placeholder={placeholder ?? t("pickers.employee.select")}
      searchPlaceholder={t("pickers.employee.search")}
      emptyText={t("pickers.employee.empty")}
      disabled={disabled}
      allowClear={allowClear}
      error={error}
      icon={<UserRound className="size-3.5 shrink-0 text-muted-foreground" />}
      triggerClassName={className}
      triggerProps={{ "aria-label": ariaLabel }}
    />
  );
}
