"use client";

import { useMemo } from "react";
import { EntityCombobox } from "@/components/shared/entity-combobox";
import { useLocale } from "@/providers/locale-provider";
import { getCountryPhoneMetadata } from "@/services/phone-service";

export interface PhoneCountryOption {
  /** The `Country.id` (UUID) this option represents — stays the form's actual `countryId` value, unrelated to the ISO2 code libphonenumber-js needs. */
  id: string;
  /** ISO 3166-1 alpha-2 — `Country.code`, already the region key `phone-service.ts` and the API's `PhoneNumberService` both use. */
  code: string;
  /** The Country entity's own display name (Arabic by default in this app) — always shown and always searchable, even for a `code` libphonenumber-js doesn't recognize. */
  name: string;
}

/**
 * The ONE searchable country selector for every phone-carrying form (Part
 * 3/15). Stores `Country.id` as the field value (so it's a drop-in swap
 * wherever `countryId` was a plain select), but shows and searches by flag +
 * Arabic/English name + calling code, all *derived* from
 * `phone-service.ts`'s computed metadata — never a second hardcoded country
 * list. The UUID and ISO code stay searchable without ever being rendered.
 *
 * Chrome comes from `EntityCombobox`, so this shares one trigger height,
 * keyboard model and empty/clear behaviour with every other picker in OMS —
 * it used to render its own popover a control-height taller than the fields
 * beside it.
 */
export function PhoneCountrySelector({
  value,
  onChange,
  countries,
  disabled,
  placeholder,
}: {
  value: string | null | undefined;
  onChange: (countryId: string) => void;
  countries: PhoneCountryOption[];
  disabled?: boolean;
  placeholder?: string;
}) {
  const { t } = useLocale();

  const selected = useMemo(() => countries.find((c) => c.id === value) ?? null, [countries, value]);
  const selectedMeta = selected ? getCountryPhoneMetadata(selected.code) : null;

  return (
    <EntityCombobox<PhoneCountryOption>
      items={countries}
      value={selected}
      onChange={(country) => onChange(country?.id ?? "")}
      disabled={disabled}
      rowLayout="inline"
      icon={selectedMeta ? <span className="shrink-0">{selectedMeta.flag}</span> : undefined}
      placeholder={placeholder ?? t("phone.countryLabel")}
      searchPlaceholder={t("phone.searchCountryPlaceholder")}
      emptyText={t("phone.noCountryFound")}
      noMatchText={t("phone.noCountryFound")}
      getId={(country) => country.id}
      getTitle={(country) => country.name}
      getIcon={(country) => {
        const flag = getCountryPhoneMetadata(country.code)?.flag;
        return flag ? <span className="shrink-0">{flag}</span> : undefined;
      }}
      getSubtitle={(country) => {
        const callingCode = getCountryPhoneMetadata(country.code)?.callingCode;
        return callingCode ? `+${callingCode}` : undefined;
      }}
      getSearchText={(country) => {
        const meta = getCountryPhoneMetadata(country.code);
        return [country.id, meta?.nameAr, meta?.nameEn, country.code, meta?.callingCode]
          .filter(Boolean)
          .join(" ");
      }}
    />
  );
}
