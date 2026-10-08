"use client";

import type { ReactNode } from "react";
import type { Control, FieldPath, FieldValues } from "react-hook-form";
import {
  Banknote,
  CreditCard,
  Globe,
  PackageCheck,
  PackagePlus,
  PackageX,
  Store,
  Truck,
  type LucideIcon,
} from "lucide-react";
import { DisclosureTrigger } from "@/components/shared/disclosure-trigger";
import {
  ComboboxFormField,
  PhoneFormField,
  TextFormField,
  TextareaFormField,
} from "@/components/shared/form-fields";
import { DeliveryFields, type DeliveryCountryOption } from "@/components/shared/delivery-fields";
import { DuplicateCustomerPanel } from "@/components/business/duplicate-customer-panel";
import { MoneyInput } from "@/components/shared/money-input";
import { SegmentedRadioGroup } from "@/components/documents/segmented-radio-group";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  FieldMessage,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import type { DuplicateChoice, DuplicatePanelState } from "@/config/orders/duplicate-panel";
import type { AvailabilityShortfall } from "@/config/orders/line-availability";
import type { PhoneCountryOption } from "@/components/shared/phone-country-selector";
import { localizedName } from "@/lib/localized-name";
import { useLocale } from "@/providers/locale-provider";

/**
 * Field blocks of the one order-entry flow (R15 W1) — both adapters compose
 * their steps from these, so a customer, a delivery or a notes field looks and
 * behaves the same in a company order, an agent order and a lead conversion.
 */

/** A country offered by the flow: the phone's calling-code option and a delivery destination. */
export type EntryCountryOption = PhoneCountryOption & DeliveryCountryOption;

/** New customer: name, country and phone side by side (the calling code lives inside the phone field). */
export function CustomerContactFields<T extends FieldValues>({
  control,
  names,
  countries,
  phoneCountryCode,
  onPhoneCode,
  onCountryChosen,
  phoneOnly = false,
}: {
  control: Control<T>;
  names: { name: FieldPath<T>; countryId: FieldPath<T>; phone: FieldPath<T> };
  countries: readonly EntryCountryOption[];
  phoneCountryCode: string | null;
  onPhoneCode: (iso2: string) => void;
  onCountryChosen: () => void;
  /** An existing customer whose stored phone is missing or invalid: only the phone is asked. */
  phoneOnly?: boolean;
}) {
  const { t, locale } = useLocale();
  const phone = (
    <PhoneFormField
      control={control}
      name={names.phone}
      label={t("storeOrders.fields.phone")}
      required
      countryCode={phoneCountryCode}
      availableCountryCodes={countries.map((country) => country.code)}
      countries={countries}
      onCountryChange={onPhoneCode}
    />
  );
  if (phoneOnly) return <div className="max-w-md">{phone}</div>;
  return (
    <div className="grid grid-cols-1 items-start gap-x-3 gap-y-2 @md:grid-cols-2 @xl:grid-cols-[minmax(0,5fr)_minmax(0,4fr)_minmax(0,6fr)]">
      <TextFormField
        control={control}
        name={names.name}
        label={t("storeOrders.createDialog.fields.customerName")}
        required
      />
      <ComboboxFormField
        control={control}
        name={names.countryId}
        label={t("storeOrders.createDialog.fields.country")}
        required
        items={[...countries]}
        getId={(country) => country.id}
        getTitle={(country) => localizedName(country, locale)}
        getSearchText={(country) =>
          [country.name, country.nameEn, country.code, country.iso3].filter(Boolean).join(" ")
        }
        icon={<Globe className="size-3.5 shrink-0 text-muted-foreground" />}
        onValueChange={onCountryChosen}
      />
      <div className="@md:col-span-2 @xl:col-span-1">{phone}</div>
    </div>
  );
}

/** The duplicate-customer answer with its gate message — the customer step cannot be left unanswered. */
export function DuplicateGate({
  state,
  onChoose,
  orderHref,
  onEditDetails,
  onCancel,
  gateMessage,
  showPanel,
}: {
  state: DuplicatePanelState;
  onChoose: (choice: DuplicateChoice | null) => void;
  orderHref: (id: string) => string;
  onEditDetails?: () => void;
  onCancel: () => void;
  gateMessage: string | null;
  showPanel: boolean;
}) {
  if (!showPanel) return gateMessage ? <FieldMessage>{gateMessage}</FieldMessage> : null;
  return (
    <div
      className="flex flex-col gap-1"
      data-field-name="duplicates"
      data-invalid={gateMessage ? "true" : undefined}
    >
      <DuplicateCustomerPanel
        state={state}
        onChoose={onChoose}
        orderHref={orderHref}
        onEditDetails={onEditDetails}
        onCancel={onCancel}
      />
      <FieldMessage>{gateMessage}</FieldMessage>
    </div>
  );
}

const CHOICE_ICON: Record<string, LucideIcon> = {
  SHIPPING: Truck,
  PICKUP: Store,
  PREPAID: CreditCard,
  CASH_ON_DELIVERY: Banknote,
  SHIPPING_ADDED: PackagePlus,
  SHIPPING_INCLUDED: PackageCheck,
};

/** A short one-of-many order term (delivery method, payment type) as a segmented form field. */
export function OrderChoiceField<T extends FieldValues, V extends string>({
  control,
  name,
  label,
  options,
  onValueChange,
}: {
  control: Control<T>;
  name: FieldPath<T>;
  label: string;
  options: { value: V; label: string }[];
  onValueChange?: (value: V) => void;
}) {
  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => (
        <FormItem>
          <FormLabel>{label}</FormLabel>
          <SegmentedRadioGroup<V>
            value={field.value as V}
            onValueChange={(value) => {
              field.onChange(value);
              onValueChange?.(value);
            }}
            aria-label={label}
            options={options.map((option) => ({ ...option, icon: CHOICE_ICON[option.value] }))}
          />
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

/**
 * A money amount kept as typed text (blank ≠ 0, design-system §12.22) — the
 * shared `MoneyInput` inside a form field.
 */
export function EntryMoneyField<T extends FieldValues>({
  control,
  name,
  label,
  required,
  optional,
  description,
}: {
  control: Control<T>;
  name: FieldPath<T>;
  label: string;
  required?: boolean;
  optional?: boolean;
  description?: string;
}) {
  return (
    <FormField
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <FormItem required={required}>
          <FormLabel required={required} optional={optional}>
            {label}
          </FormLabel>
          <FormControl>
            <MoneyInput
              name={field.name}
              ref={field.ref}
              value={(field.value as string) ?? ""}
              onChange={(event) => field.onChange(event.target.value)}
              onBlur={field.onBlur}
              aria-invalid={Boolean(fieldState.error) || undefined}
            />
          </FormControl>
          {description ? <FormDescription>{description}</FormDescription> : null}
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

/** Delivery method + payment type, the two order terms every adapter asks. */
export function OrderTermsFields<T extends FieldValues>({
  control,
  names,
  onMethodChange,
}: {
  control: Control<T>;
  names: { method: FieldPath<T>; paymentType: FieldPath<T> };
  onMethodChange?: (method: "SHIPPING" | "PICKUP") => void;
}) {
  const { t } = useLocale();
  return (
    <div className="flex flex-wrap gap-x-6 gap-y-3">
      <OrderChoiceField<T, "SHIPPING" | "PICKUP">
        control={control}
        name={names.method}
        label={t("storeOrders.createDialog.entry.method")}
        onValueChange={onMethodChange}
        options={[
          { value: "SHIPPING", label: t("storeOrders.createDialog.entry.methodShipping") },
          { value: "PICKUP", label: t("storeOrders.createDialog.entry.methodPickup") },
        ]}
      />
      <OrderChoiceField<T, "PREPAID" | "CASH_ON_DELIVERY">
        control={control}
        name={names.paymentType}
        label={t("storeOrders.fields.paymentType")}
        options={[
          { value: "PREPAID", label: t("storeOrders.paymentType.PREPAID") },
          { value: "CASH_ON_DELIVERY", label: t("storeOrders.paymentType.CASH_ON_DELIVERY") },
        ]}
      />
    </div>
  );
}

/**
 * Where the order goes: City + Address once, the delivery country following the
 * customer's until "Different delivery country" (design-system §12.22). Pickup
 * and service-only orders show why no address is asked.
 */
export function OrderDeliveryFields<T extends FieldValues>({
  control,
  names,
  countries,
  needsDelivery,
  showFields,
  pickup,
  differentCountry,
  onDifferentCountryChange,
  before,
}: {
  control: Control<T>;
  names: { countryId: FieldPath<T>; city: FieldPath<T>; address: FieldPath<T> };
  countries: readonly DeliveryCountryOption[];
  needsDelivery: boolean;
  /** False while an existing customer's own address is used (the caller shows it). */
  showFields: boolean;
  pickup: boolean;
  differentCountry: boolean;
  onDifferentCountryChange: (value: boolean) => void;
  /** Adapter-specific line above the fields (existing customer's address, an order-only note). */
  before?: ReactNode;
}) {
  const { t } = useLocale();
  if (!needsDelivery) {
    return (
      <p className="text-caption text-muted-foreground" data-testid="no-delivery-note">
        {pickup
          ? t("storeOrders.createDialog.entry.pickupNote")
          : t("storeOrders.createDialog.entry.nonPhysicalNote")}
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-1.5">
      {before}
      {showFields ? (
        <DeliveryFields
          control={control}
          names={names}
          labels={{
            country: t("storeOrders.createDialog.fields.deliveryCountry"),
            city: t("storeOrders.createDialog.fields.city"),
            address: t("storeOrders.createDialog.fields.address"),
          }}
          countries={countries}
          differentCountry={differentCountry}
          onDifferentCountryChange={onDifferentCountryChange}
        />
      ) : null}
    </div>
  );
}

/** Optional notes behind a disclosure (progressive disclosure, no bordered box). */
export function NotesDisclosure<T extends FieldValues>({
  control,
  name,
  defaultOpen,
}: {
  control: Control<T>;
  name: FieldPath<T>;
  defaultOpen: boolean;
}) {
  const { t } = useLocale();
  return (
    <Collapsible defaultOpen={defaultOpen}>
      <CollapsibleTrigger asChild>
        <DisclosureTrigger>
          {t("storeOrders.createDialog.sections.notes")}
          <span className="font-normal">({t("common.optional")})</span>
        </DisclosureTrigger>
      </CollapsibleTrigger>
      <CollapsibleContent className="pt-2">
        <TextareaFormField
          control={control}
          name={name}
          label={t("storeOrders.createDialog.fields.notes")}
          optional
        />
      </CollapsibleContent>
    </Collapsible>
  );
}

/**
 * Lines asking for more than is available to sell (spec 1.10): a warning, never
 * a block — the order is saved as awaiting stock.
 */
export function AvailabilityNotice({
  shortfalls,
  productName,
}: {
  shortfalls: readonly AvailabilityShortfall[];
  productName: (productId: string) => string;
}) {
  const { t } = useLocale();
  if (shortfalls.length === 0) return null;
  return (
    <Alert tone="warning" data-testid="availability-notice">
      <PackageX />
      <div className="flex min-w-0 flex-col gap-0.5">
        <AlertTitle>{t("orderEntry.availability.title")}</AlertTitle>
        <AlertDescription>
          <ul className="flex flex-col gap-0.5">
            {shortfalls.map((shortfall) => (
              <li key={shortfall.productId}>
                {t("orderEntry.availability.line", {
                  product: productName(shortfall.productId),
                  requested: shortfall.requested,
                  available: shortfall.available,
                })}
              </li>
            ))}
          </ul>
          <p className="mt-1">{t("orderEntry.availability.hint")}</p>
        </AlertDescription>
      </div>
    </Alert>
  );
}
