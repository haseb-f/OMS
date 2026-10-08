"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { defaultPhoneCountry, parsePhone } from "@/services/phone-service";
import {
  proposeForCountry,
  type EntryCountry,
  type EntryCurrency,
} from "@/config/orders/country-entry-defaults";

/** The O2 default country (Saudi Arabia) among the offered countries — used until one is chosen. */
export function defaultEntryCountryId(countries: readonly EntryCountry[]): string {
  const code = defaultPhoneCountry(countries.map((country) => country.code));
  return code ? (countries.find((country) => country.code === code)?.id ?? "") : "";
}

/**
 * R11 / R12 phone and country rules of the order-entry flow (both adapters):
 * the customer's country proposes the phone's calling code (and, for company
 * orders, the order currency); the calling code is its own choice inside the
 * phone field (an international phone, a local delivery) — once picked, or
 * once a number is typed under it, it is never changed behind the user's back,
 * and a typed number is never re-read under another code. A manual currency is
 * never overwritten; a country without a configured currency leaves it empty.
 */
export function useEntryCountry({
  countryId,
  phoneCountryCodeRef,
  countries,
  currencies,
  getPhone,
  currencyId,
  onProposeCurrency,
  defaultCountryId,
  onDefaultCountry,
}: {
  /** The customer's country (form value). */
  countryId: string | null | undefined;
  /** Receives the calling code the phone is read with — the form schema reads it at validation time. */
  phoneCountryCodeRef: RefObject<string | null>;
  countries: readonly EntryCountry[];
  /** Company only: the currencies the form offers (empty = no currency proposal). */
  currencies?: readonly EntryCurrency[];
  getPhone: () => string | null | undefined;
  /** Company only: the current currency (form value) and how to apply a proposal. */
  currencyId?: string | null;
  onProposeCurrency?: (currencyId: string) => void;
  /** A safe default country to apply while none is chosen (never marks the form dirty); null = none. */
  defaultCountryId?: string | null;
  onDefaultCountry?: (countryId: string) => void;
}) {
  // The calling code chosen in the phone field, or kept for an already typed number.
  const [phoneCountryOverride, setPhoneCountryOverride] = useState<string | null>(null);
  const currencyTouchedRef = useRef(false);

  // O2 default (Saudi Arabia) — the calling code used until a country or a code is chosen.
  const fallbackPhoneCountryId = useMemo(() => defaultEntryCountryId(countries), [countries]);

  useEffect(() => {
    if (countryId || !defaultCountryId || !onDefaultCountry) return;
    onDefaultCountry(defaultCountryId);
  }, [countryId, defaultCountryId, onDefaultCountry]);

  const proposal = useMemo(
    () => proposeForCountry(countryId, countries, currencies ?? []),
    [countryId, countries, currencies],
  );
  const phoneCountryId = phoneCountryOverride ?? proposal.phoneCountryId ?? fallbackPhoneCountryId;
  const phoneCountryCode = countries.find((country) => country.id === phoneCountryId)?.code ?? null;
  useEffect(() => {
    phoneCountryCodeRef.current = phoneCountryCode;
  }, [phoneCountryCode, phoneCountryCodeRef]);

  // The currency follows the country's configured default until the user chooses one.
  const currencyCount = currencies?.length ?? 0;
  useEffect(() => {
    if (!onProposeCurrency || currencyTouchedRef.current || currencyCount === 0) return;
    const next = proposal.currencyId ?? "";
    if ((currencyId ?? "") !== next) onProposeCurrency(next);
  }, [proposal.currencyId, currencyCount, currencyId, onProposeCurrency]);

  /** The phone's own country (from a stored E.164) when it differs from the customer's country. */
  const phoneCountryOverrideFor = useCallback(
    (phone: string | null | undefined, customerCountryId?: string | null) => {
      const region = parsePhone(phone, null).detectedRegion;
      const match = region ? countries.find((country) => country.code === region) : undefined;
      return match && match.id !== customerCountryId ? match.id : null;
    },
    [countries],
  );

  return {
    phoneCountryId,
    phoneCountryCode,
    phoneCountryOverride,
    setPhoneCountryOverride,
    phoneCountryOverrideFor,
    /** The calling code picked inside the phone field (ISO-2). */
    selectPhoneCode: (iso2: string) => {
      const match = countries.find((country) => country.code === iso2);
      if (match) setPhoneCountryOverride(match.id);
    },
    /** The user chose a country: a number already typed keeps the calling code it was read with. */
    onCountryChosen: () => {
      if (phoneCountryOverride === null && getPhone()?.trim()) {
        setPhoneCountryOverride(phoneCountryId || null);
      }
    },
    /** No configured currency for the chosen country — the form asks (company). */
    noCurrencyDefault: !currencyId && !!countryId && currencyCount > 0,
    markCurrencyTouched: () => {
      currencyTouchedRef.current = true;
    },
    resetCurrencyTouched: () => {
      currencyTouchedRef.current = false;
    },
  };
}
