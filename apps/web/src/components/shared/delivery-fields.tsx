"use client";

import type { Control, FieldPath, FieldValues } from "react-hook-form";
import { Globe } from "lucide-react";
import { EnterpriseButton } from "@/components/ui/button";
import { ComboboxFormField, TextFormField } from "@/components/shared/form-fields";
import { useLocale } from "@/providers/locale-provider";
import { localizedName } from "@/lib/localized-name";

export interface DeliveryCountryOption {
  id: string;
  name: string;
  nameEn?: string | null;
  code: string;
  iso3?: string | null;
  callingCode?: string | null;
}

/**
 * Where an order is delivered — entered ONCE. The delivery country follows the
 * phone's country (the calling code in the phone field) until the user opens
 * "Different delivery country", so the normal case shows only City and Address
 * side by side; a legitimate international-phone / local-delivery combination
 * stays one click away and is preserved. The caller owns the country value
 * (it keeps it in sync with the phone country while `differentCountry` is off).
 */
export function DeliveryFields<TFieldValues extends FieldValues>({
  control,
  names,
  labels,
  countries,
  differentCountry,
  onDifferentCountryChange,
  disabled,
}: {
  control: Control<TFieldValues>;
  names: {
    countryId: FieldPath<TFieldValues>;
    city: FieldPath<TFieldValues>;
    address: FieldPath<TFieldValues>;
  };
  labels: { country: string; city: string; address: string };
  countries: readonly DeliveryCountryOption[];
  differentCountry: boolean;
  onDifferentCountryChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  const { t, locale } = useLocale();
  return (
    <div className="flex flex-col gap-2" data-testid="delivery-fields">
      <div className="grid grid-cols-1 items-start gap-x-3 gap-y-2 @md:grid-cols-6">
        {differentCountry ? (
          <div className="@md:col-span-6" data-testid="delivery-country">
            <ComboboxFormField
              control={control}
              name={names.countryId}
              label={labels.country}
              optional
              items={[...countries]}
              getId={(country) => country.id}
              getTitle={(country) => localizedName(country, locale)}
              getSearchText={(country) =>
                [country.name, country.nameEn, country.code, country.iso3, country.callingCode]
                  .filter(Boolean)
                  .join(" ")
              }
              allowClear
              disabled={disabled}
              icon={<Globe className="size-3.5 shrink-0 text-muted-foreground" />}
            />
          </div>
        ) : null}
        <div className="@md:col-span-2">
          <TextFormField
            control={control}
            name={names.city}
            label={labels.city}
            optional
            disabled={disabled}
          />
        </div>
        <div className="@md:col-span-4">
          <TextFormField
            control={control}
            name={names.address}
            label={labels.address}
            optional
            disabled={disabled}
          />
        </div>
      </div>
      <EnterpriseButton
        type="button"
        variant="link"
        size="inline"
        className="self-start"
        disabled={disabled}
        aria-pressed={differentCountry}
        onClick={() => onDifferentCountryChange(!differentCountry)}
        data-testid="delivery-country-toggle"
      >
        {differentCountry
          ? t("storeOrders.createDialog.entry.sameCountry")
          : t("storeOrders.createDialog.entry.differentCountry")}
      </EnterpriseButton>
    </div>
  );
}
