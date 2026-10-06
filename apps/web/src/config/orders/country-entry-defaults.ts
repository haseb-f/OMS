import { getCountryPhoneMetadata } from "@/services/phone-service";
import { canProposeCallingCode } from "@/lib/phone-calling-code";

/**
 * Smart defaults of an order-entry form (R12): choosing the customer's COUNTRY
 * proposes the calling code of the phone field and the order currency. Both are
 * only proposals — the user can change either at any time and a manual choice
 * is never overwritten (the caller tracks "touched"; this module only says what
 * the proposal would be).
 *
 * Sources are maintained data, never guesses:
 * - calling code → the phone library's country metadata (`getCountryPhoneMetadata`);
 * - currency → `Country.defaultCurrencyId` (master data → Countries), and only a
 *   currency that is actually offered by the form.
 * No unambiguous default → `null` and the form asks the user to choose.
 */
export interface EntryCountry {
  id: string;
  code: string;
  defaultCurrencyId?: string | null;
}

export interface EntryCurrency {
  id: string;
}

export interface CountryEntryProposal {
  /** The country whose calling code the phone field should read with — `null` when the country has no calling code (user chooses). */
  phoneCountryId: string | null;
  /** The currency to propose — `null` when the country has no configured default (user chooses). */
  currencyId: string | null;
}

export function proposeForCountry(
  countryId: string | null | undefined,
  countries: readonly EntryCountry[],
  currencies: readonly EntryCurrency[],
): CountryEntryProposal {
  const country = countryId ? countries.find((row) => row.id === countryId) : undefined;
  if (!country) return { phoneCountryId: null, currencyId: null };
  const hasCallingCode = Boolean(getCountryPhoneMetadata(country.code)?.callingCode);
  const currency = country.defaultCurrencyId
    ? currencies.find((row) => row.id === country.defaultCurrencyId)
    : undefined;
  return {
    phoneCountryId: hasCallingCode ? country.id : null,
    currencyId: currency?.id ?? null,
  };
}

/**
 * Which proposals may be applied right now. A proposal is applied only while the
 * user has not made that choice themselves, and the calling code additionally
 * only while the phone field is empty — an already-entered number is never
 * re-read under another code behind the user's back.
 */
export function applicableProposals(input: {
  phoneCodeTouched: boolean;
  currencyTouched: boolean;
  phoneHasValue: boolean;
}): { phone: boolean; currency: boolean } {
  return {
    phone: canProposeCallingCode({
      codeChosen: input.phoneCodeTouched,
      hasNumber: input.phoneHasValue,
    }),
    currency: !input.currencyTouched,
  };
}
