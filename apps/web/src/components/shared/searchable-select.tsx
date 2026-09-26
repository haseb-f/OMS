"use client";

import { useMemo, type ReactNode } from "react";
import { useLocale } from "@/providers/locale-provider";
import {
  EntityCombobox,
  type EntityComboboxCreateAction,
} from "@/components/shared/entity-combobox";

/**
 * Above this many options a plain `Select` becomes a scroll hunt — switch to
 * `SearchableSelect`. Same threshold `SelectFilter` uses to show its search box.
 */
export const SEARCHABLE_OPTION_THRESHOLD = 7;

export interface SearchableSelectOption {
  value: string;
  label: string;
  /** Secondary line (code, parent, type). */
  description?: ReactNode;
  /** Extra text matched by the search box but not shown (codes, English names). */
  searchText?: string;
  icon?: ReactNode;
}

/**
 * Value-based searchable select — the drop-in replacement for `ui/select`
 * whenever the option list is long or comes from reference data (accounts,
 * currencies, units, taxes, job titles, CSV headers…). It keeps the string
 * value contract of `<Select value onValueChange>` so a form's state and
 * validation stay untouched, and renders through `EntityCombobox` so search,
 * keyboard, clear, loading/empty states and "Create new" behave like every
 * other OMS picker.
 *
 * Works inside `<FormControl>`: the Slot-injected `id`, `aria-describedby`
 * and `aria-invalid` land on the trigger, so `FormLabel` points at it.
 */
export function SearchableSelect({
  value,
  onValueChange,
  options,
  placeholder,
  searchPlaceholder,
  emptyText,
  disabled,
  allowClear = false,
  loading,
  error,
  icon,
  createAction,
  selectedLabel,
  subtitleDir,
  variant,
  className,
  id,
  "aria-label": ariaLabel,
  "aria-describedby": ariaDescribedBy,
  "aria-invalid": ariaInvalid,
}: {
  value: string | null | undefined;
  onValueChange: (value: string) => void;
  options: SearchableSelectOption[];
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  disabled?: boolean;
  /** Shows an × that resets the value to `""`. */
  allowClear?: boolean;
  loading?: boolean;
  error?: boolean;
  icon?: ReactNode;
  createAction?: EntityComboboxCreateAction;
  /** Label to show when `value` is set but not (yet) among `options` — e.g. an archived record. */
  selectedLabel?: string;
  subtitleDir?: "ltr" | "rtl";
  variant?: "default" | "ghost";
  className?: string;
  id?: string;
  "aria-label"?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean | "true" | "false";
}) {
  const { t } = useLocale();
  const selected = useMemo<SearchableSelectOption | null>(() => {
    if (!value) return null;
    return (
      options.find((option) => option.value === value) ?? {
        value,
        // Never the raw value (usually a UUID): an archived/inactive or
        // not-yet-loaded record reads as such until the caller names it.
        label: selectedLabel ?? (loading ? "…" : t("pickers.option.unavailable")),
      }
    );
  }, [value, options, selectedLabel, loading, t]);

  return (
    <EntityCombobox
      id={id}
      items={options}
      value={selected}
      onChange={(option) => onValueChange(option?.value ?? "")}
      getId={(option) => option.value}
      getTitle={(option) => option.label}
      getSubtitle={(option) => option.description}
      getSearchText={(option) => option.searchText ?? ""}
      getIcon={(option) => option.icon}
      placeholder={placeholder}
      searchPlaceholder={searchPlaceholder ?? t("pickers.option.search")}
      emptyText={emptyText ?? t("pickers.option.empty")}
      disabled={disabled}
      allowClear={allowClear}
      loading={loading}
      error={error || ariaInvalid === true || ariaInvalid === "true"}
      icon={icon}
      createAction={createAction}
      subtitleDir={subtitleDir}
      variant={variant}
      triggerClassName={className}
      triggerProps={{ "aria-label": ariaLabel, "aria-describedby": ariaDescribedBy }}
    />
  );
}
