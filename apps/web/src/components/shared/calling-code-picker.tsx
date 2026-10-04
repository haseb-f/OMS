"use client";

import { useMemo, useState } from "react";
import { Check } from "lucide-react";
import { InputGroupButton } from "@/components/ui/input-group";
import { Popover, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandPopoverContent,
  CommandResultRow,
} from "@/components/ui/command";
import { TriggerChevron } from "@/components/ui/trigger-chevron";
import { filterByArabicSearch } from "@/lib/arabic-search";
import { localizedName } from "@/lib/localized-name";
import { useLocale } from "@/providers/locale-provider";
import { getCountryPhoneMetadata } from "@/services/phone-service";
import type { PhoneCountryOption } from "@/components/shared/phone-country-selector";
import { cn } from "@/lib/utils";

/**
 * The compact calling-code selector that lives INSIDE the phone field
 * (`OMSPhoneInput` → "flag +966 ▾") — it replaces the separate, full-width
 * "phone country" dropdown. Choosing a country here only changes how the
 * national number is read (the calling code); it never changes the delivery
 * country on its own — the form decides how the two relate. Options come from
 * the form's own country list; flag, name and calling code are derived from
 * the phone library's metadata, never a second hardcoded list.
 */
export function CallingCodePicker({
  countryCode,
  countries,
  onSelect,
  disabled,
}: {
  /** ISO2 of the selected phone country. */
  countryCode: string | null | undefined;
  countries: readonly PhoneCountryOption[];
  /** Receives the ISO2 code of the picked country. */
  onSelect: (iso2: string) => void;
  disabled?: boolean;
}) {
  const { t, locale } = useLocale();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const meta = countryCode ? getCountryPhoneMetadata(countryCode) : null;
  const items = useMemo(
    () => filterByArabicSearch([...countries], search, (country) => searchText(country)),
    [countries, search],
  );

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setSearch("");
      }}
      modal={false}
    >
      <PopoverTrigger asChild>
        <InputGroupButton
          type="button"
          variant="ghost"
          size="xs"
          disabled={disabled}
          aria-label={t("phone.callingCodePicker")}
          aria-haspopup="listbox"
          aria-expanded={open}
          data-testid="calling-code-picker"
          className="gap-1 px-1.5 tabular-nums text-foreground pointer-coarse:h-9"
        >
          <span aria-hidden className="shrink-0">
            {meta?.flag ?? "🌐"}
          </span>
          <span dir="ltr">{meta?.callingCode ? `+${meta.callingCode}` : "+"}</span>
          <TriggerChevron />
        </InputGroupButton>
      </PopoverTrigger>
      <CommandPopoverContent align="start" className="w-72 max-w-[calc(100vw-2rem)]">
        <Command shouldFilter={false}>
          <CommandInput
            placeholder={t("phone.searchCountryPlaceholder")}
            value={search}
            onValueChange={setSearch}
            onClear={() => setSearch("")}
            clearLabel={t("table.clearSearch")}
          />
          <CommandList>
            {items.length === 0 ? <CommandEmpty>{t("phone.noCountryFound")}</CommandEmpty> : null}
            <CommandGroup>
              {items.map((country) => {
                const info = getCountryPhoneMetadata(country.code);
                return (
                  <CommandItem
                    key={country.id}
                    value={country.id}
                    data-checked={country.code === countryCode}
                    onSelect={() => {
                      onSelect(country.code);
                      setOpen(false);
                      setSearch("");
                    }}
                  >
                    <CommandResultRow
                      icon={info?.flag ? <span className="shrink-0">{info.flag}</span> : undefined}
                      title={localizedName(country, locale)}
                      subtitle={info?.callingCode ? `+${info.callingCode}` : undefined}
                      subtitleDir="ltr"
                      layout="inline"
                    />
                    <Check
                      aria-hidden
                      className={cn(
                        "ms-auto size-3.5 shrink-0",
                        country.code === countryCode ? "opacity-100" : "opacity-0",
                      )}
                    />
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

function searchText(country: PhoneCountryOption): string {
  const info = getCountryPhoneMetadata(country.code);
  return [
    country.name,
    country.nameEn,
    country.code,
    country.iso3,
    country.callingCode,
    info?.nameAr,
    info?.nameEn,
    info?.callingCode ? `+${info.callingCode}` : undefined,
  ]
    .filter(Boolean)
    .join(" ");
}
