"use client";

import { Coins } from "lucide-react";
import { SearchableSelect } from "@/components/shared/searchable-select";
import { useCurrencies } from "@/hooks/use-reference-data";
import { useLocale } from "@/providers/locale-provider";

/**
 * The one currency selector. Backed by the session-cached `useCurrencies`
 * list (no per-mount fetch); value is the currency `code` by default, or its
 * `id` for DTOs that store the FK.
 */
export function CurrencyPicker({
  value,
  onValueChange,
  valueKey = "code",
  disabled,
  allowClear = false,
  error,
  className,
  placeholder,
  id,
  "aria-label": ariaLabel,
  "aria-describedby": ariaDescribedBy,
  "aria-invalid": ariaInvalid,
}: {
  value: string | null | undefined;
  onValueChange: (value: string) => void;
  valueKey?: "code" | "id";
  disabled?: boolean;
  allowClear?: boolean;
  error?: boolean;
  className?: string;
  /** Empty-state text, e.g. "Base currency" when empty means the functional currency. */
  placeholder?: string;
  id?: string;
  "aria-label"?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean | "true" | "false";
}) {
  const { t } = useLocale();
  const currencies = useCurrencies();
  const options = currencies
    .filter((currency) => !currency.deletedAt || currency[valueKey] === value)
    .map((currency) => ({
      value: currency[valueKey],
      label: currency.code,
      description: currency.name,
      searchText: `${currency.name} ${currency.symbol ?? ""}`,
    }));

  return (
    <SearchableSelect
      id={id}
      value={value}
      onValueChange={onValueChange}
      options={options}
      loading={useCurrencies.isLoading()}
      placeholder={placeholder ?? t("pickers.currency.select")}
      searchPlaceholder={t("pickers.currency.search")}
      emptyText={t("pickers.currency.empty")}
      disabled={disabled}
      allowClear={allowClear}
      error={error}
      subtitleDir="rtl"
      icon={<Coins className="size-3.5 shrink-0 text-muted-foreground" />}
      className={className}
      aria-label={ariaLabel}
      aria-describedby={ariaDescribedBy}
      aria-invalid={ariaInvalid}
    />
  );
}
