"use client";

import { useMemo, useState } from "react";
import { ChevronsUpDown } from "lucide-react";
import { Popover, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandPopoverContent,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { EnterpriseButton } from "@/components/ui/button";
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
 * 3/15) — replaces the plain, non-searchable, flag-less `<Select>` the
 * Country field used before. Still stores `Country.id` as the field value
 * (so it's a drop-in swap wherever `countryId` was a plain select), but
 * shows and searches by flag + Arabic/English name + calling code, all
 * *derived* from `phone-service.ts`'s computed metadata — never a second
 * hardcoded country list.
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
  const [open, setOpen] = useState(false);

  const selected = useMemo(() => countries.find((c) => c.id === value) ?? null, [countries, value]);
  const selectedMeta = selected ? getCountryPhoneMetadata(selected.code) : null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <EnterpriseButton
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className="w-full justify-between font-normal"
        >
          <span className="flex min-w-0 items-center gap-2">
            {selectedMeta && <span className="shrink-0">{selectedMeta.flag}</span>}
            <span className="truncate">
              {selected ? selected.name : (placeholder ?? t("phone.countryLabel"))}
            </span>
            {selectedMeta && (
              <span dir="ltr" className="shrink-0 text-muted-foreground">
                +{selectedMeta.callingCode}
              </span>
            )}
          </span>
          <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
        </EnterpriseButton>
      </PopoverTrigger>
      <CommandPopoverContent>
        <Command>
          <CommandInput placeholder={t("phone.searchCountryPlaceholder")} />
          <CommandList>
            <CommandEmpty>{t("phone.noCountryFound")}</CommandEmpty>
            <CommandGroup>
              {countries.map((country) => {
                const meta = getCountryPhoneMetadata(country.code);
                const searchValue = [
                  country.id,
                  country.name,
                  meta?.nameAr,
                  meta?.nameEn,
                  country.code,
                  meta?.callingCode,
                ]
                  .filter(Boolean)
                  .join(" ");
                return (
                  <CommandItem
                    key={country.id}
                    value={searchValue}
                    onSelect={() => {
                      onChange(country.id);
                      setOpen(false);
                    }}
                    data-checked={value === country.id}
                  >
                    <span className="flex w-full items-center gap-2">
                      {meta && <span className="shrink-0">{meta.flag}</span>}
                      <span className="min-w-0 flex-1 truncate">{country.name}</span>
                      {meta && (
                        <span dir="ltr" className="shrink-0 text-caption text-muted-foreground">
                          +{meta.callingCode}
                        </span>
                      )}
                    </span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </CommandPopoverContent>
    </Popover>
  );
}
