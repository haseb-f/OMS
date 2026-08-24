import { Injectable } from '@nestjs/common';
import {
  parsePhoneNumberFromString,
  validatePhoneNumberLength,
  getCountryCallingCode,
  getCountries,
  type CountryCode,
} from 'libphonenumber-js';
import examples from 'libphonenumber-js/examples.mobile.json';

export type PhoneErrorReason =
  | 'EMPTY'
  | 'NOT_A_NUMBER'
  | 'TOO_SHORT'
  | 'TOO_LONG'
  | 'INVALID_LENGTH'
  | 'INVALID_COUNTRY'
  | 'INVALID_PATTERN';

export interface PhoneParseResult {
  isValid: boolean;
  /** Canonical storage format — always this when `isValid`. */
  e164: string | null;
  nationalNumber: string | null;
  callingCode: string | null;
  /** The ISO2 region libphonenumber-js actually detected the number as belonging to — can differ from `defaultRegion` (e.g. a `+20...` number typed while Saudi Arabia is selected). */
  detectedRegion: CountryCode | null;
  /** `MOBILE` / `FIXED_LINE` / `FIXED_LINE_OR_MOBILE` / etc. — null when the region's metadata can't distinguish types. */
  type: string | null;
  /** True only when a `defaultRegion` was supplied AND the number parsed as belonging to a different region. */
  regionMismatch: boolean;
  errorReason: PhoneErrorReason | null;
}

const SUPPORTED_REGIONS = new Set<string>(getCountries());

/**
 * Documented Saudi Arabia mobile-number rule (Saudi Phone Normalization
 * Hotfix) — every Saudi mobile subscriber number is the digit "5" followed
 * by exactly eight more digits (STC/Mobily/Zain's shared numbering plan;
 * `libphonenumber-js`'s own SA metadata agrees — this pattern is never
 * invented, only restated explicitly so a bare national number like
 * "564345678" normalizes correctly even if something upstream fails to
 * resolve/pass the "SA" region cleanly). Only ever used as a fallback
 * AFTER the library's own region-aware parse already failed — the result
 * still goes through the library's real `.isValid()` check below, never a
 * silent bypass.
 */
const SAUDI_CALLING_CODE = '966';
const SAUDI_MOBILE_NATIONAL_PATTERN = /^5\d{8}$/;

/** Accepts "SA" case/whitespace-insensitively, and the ISO3 "SAU" some upstream data sources use instead of ISO2 — never any other country. */
function isSaudiRegionHint(regionHint: string | null | undefined): boolean {
  if (!regionHint) return false;
  const normalized = regionHint.trim().toUpperCase();
  return normalized === 'SA' || normalized === 'SAU';
}

/**
 * Strip separators operators commonly type into spreadsheets, then turn a
 * leading "00" international prefix into "+". Does not invent a country
 * calling code — `parse()` still uses `defaultRegion` (or an embedded "+")
 * to decide the actual region.
 */
export function preparePhoneInput(rawInput: string): string {
  const stripped = rawInput.trim().replace(/[\s\-\u2010-\u2015().]/g, '');
  if (stripped.startsWith('00')) return `+${stripped.slice(2)}`;
  return stripped;
}

/** English messages, matching this API's existing `BadRequestException` convention — the frontend produces its own Arabic-first copy for the same `errorReason` codes. */
export function phoneErrorMessage(reason: PhoneErrorReason | null): string {
  switch (reason) {
    case 'EMPTY':
      return 'Phone number is required.';
    case 'TOO_SHORT':
      return 'Phone number is too short for the selected country.';
    case 'TOO_LONG':
      return 'Phone number is too long for the selected country.';
    case 'INVALID_LENGTH':
      return 'Phone number length is invalid for the selected country.';
    case 'INVALID_COUNTRY':
      return 'Phone number does not match the selected country.';
    case 'NOT_A_NUMBER':
      return 'This does not look like a phone number.';
    case 'INVALID_PATTERN':
    default:
      return 'Phone number is invalid for the selected country.';
  }
}

/**
 * The ONE place in the API that understands phone numbers — every module
 * with a phone/mobile field (Leads, Customers, Suppliers, Users, Sales
 * Orders' snapshot, Import Center) goes through this instead of hand-rolling
 * its own regex. Wraps `libphonenumber-js`, whose metadata already answers
 * everything a plain regex can't: valid lengths, prefixes, and mobile vs
 * fixed-line rules differ per country and change over time as numbering
 * plans change — that's the library's data to maintain, not ours.
 *
 * `defaultRegion` should always be the ISO2 `Country.code` the user selected
 * in the same form (Lead/Customer/Supplier already carry a `countryId` FK
 * next to their phone field) — it's what lets a local format like
 * "0501234567" resolve correctly, and what a leading "00" needs to be
 * recognized as an international dialing prefix. A number that already
 * starts with "+" is parsed by its own embedded country code regardless of
 * `defaultRegion` (see `regionMismatch`).
 */
@Injectable()
export class PhoneNumberService {
  isSupportedRegion(
    regionCode: string | null | undefined,
  ): regionCode is CountryCode {
    const normalized = regionCode?.trim().toUpperCase();
    return !!normalized && SUPPORTED_REGIONS.has(normalized);
  }

  parse(
    rawInput: string | null | undefined,
    defaultRegion?: string | null,
  ): PhoneParseResult {
    const empty: PhoneParseResult = {
      isValid: false,
      e164: null,
      nationalNumber: null,
      callingCode: null,
      detectedRegion: null,
      type: null,
      regionMismatch: false,
      errorReason: 'EMPTY',
    };
    const trimmed = rawInput?.trim();
    if (!trimmed) return empty;

    const prepared = preparePhoneInput(trimmed);
    // Trim/uppercase absorbs whitespace or casing drift from upstream data
    // (" sa", "sa") — `isSupportedRegion` itself normalizes the same way,
    // this just keeps the value used for every call below in sync with it.
    const normalizedRegionInput = defaultRegion?.trim().toUpperCase();
    const region = this.isSupportedRegion(normalizedRegionInput)
      ? normalizedRegionInput
      : undefined;
    // The Saudi fallback runs BEFORE the generic international-without-plus
    // attempt: `parsePhoneNumberFromString("+" + digits)` on a bare Saudi
    // national number can structurally parse as a DIFFERENT country's
    // number (e.g. "564345678" → "+564345678" reads as a Chilean "+56"
    // number) and `??` only continues past `undefined`, not an
    // already-parsed-but-invalid result — so the wrong-country guess would
    // otherwise win before Saudi Arabia's own explicit rule ever runs. The
    // Saudi check itself only ever fires when the caller's region hint
    // clearly means Saudi Arabia, so this never changes behavior for any
    // other country.
    const parsed =
      parsePhoneNumberFromString(prepared, region) ??
      this.parseSaudiNationalFallback(prepared, defaultRegion, region) ??
      this.parseInternationalWithoutPlus(prepared, region);

    if (!parsed) {
      return {
        ...empty,
        errorReason: this.lengthErrorReason(prepared, region) ?? 'NOT_A_NUMBER',
      };
    }

    const isValid = parsed.isValid();
    const detectedRegion = parsed.country ?? null;
    const regionMismatch =
      !!region && !!detectedRegion && detectedRegion !== region;

    if (!isValid) {
      return {
        isValid: false,
        e164: null,
        nationalNumber: parsed.nationalNumber ?? null,
        callingCode: parsed.countryCallingCode ?? null,
        detectedRegion,
        type: null,
        regionMismatch,
        errorReason:
          this.lengthErrorReason(prepared, detectedRegion ?? region) ??
          'INVALID_PATTERN',
      };
    }

    return {
      isValid: true,
      e164: parsed.number,
      nationalNumber: parsed.nationalNumber,
      callingCode: parsed.countryCallingCode,
      detectedRegion,
      type: parsed.getType() ?? null,
      regionMismatch,
      errorReason: null,
    };
  }

  /**
   * Saudi Phone Normalization Hotfix — a documented, explicit rule (see
   * `SAUDI_MOBILE_NATIONAL_PATTERN`), never a silent bypass: only fires
   * when (a) the caller's own region hint clearly means Saudi Arabia (even
   * if it failed the strict `isSupportedRegion` gate above, e.g. "SAU"),
   * and (b) the digits are EXACTLY the documented Saudi mobile shape —
   * "5" + eight digits, with an optional leading trunk "0". The candidate
   * is still re-parsed and re-validated through the real library below;
   * this never invents a result the final `.isValid()` check doesn't agree
   * with, it only makes sure the "+966" context is actually tried.
   */
  private parseSaudiNationalFallback(
    prepared: string,
    rawRegionHint: string | null | undefined,
    resolvedRegion: CountryCode | undefined,
  ) {
    if (resolvedRegion && resolvedRegion !== 'SA') return undefined;
    if (!resolvedRegion && !isSaudiRegionHint(rawRegionHint)) return undefined;
    const withoutPlus = prepared.startsWith('+') ? prepared.slice(1) : prepared;
    const national = withoutPlus.startsWith('0')
      ? withoutPlus.slice(1)
      : withoutPlus;
    if (!SAUDI_MOBILE_NATIONAL_PATTERN.test(national)) return undefined;
    return parsePhoneNumberFromString(
      `+${SAUDI_CALLING_CODE}${national}`,
      'SA',
    );
  }

  /**
   * Spreadsheet values often omit "+" but include the country calling code
   * (`966501234567`). Retry as an explicit international number only when
   * the digits already start with a real calling code — never by prepending
   * the selected region's code onto a local number.
   */
  private parseInternationalWithoutPlus(
    prepared: string,
    region?: CountryCode,
  ) {
    if (prepared.startsWith('+') || !/^\d{8,15}$/.test(prepared))
      return undefined;
    return parsePhoneNumberFromString(`+${prepared}`, region);
  }

  /** Convenience — E.164 string when valid, `null` otherwise. Never throws. */
  normalizeToE164(
    rawInput: string | null | undefined,
    defaultRegion?: string | null,
  ): string | null {
    return this.parse(rawInput, defaultRegion).e164;
  }

  isValidForRegion(
    rawInput: string | null | undefined,
    regionCode: string,
  ): boolean {
    return this.parse(rawInput, regionCode).isValid;
  }

  getCallingCode(regionCode: string): string | null {
    if (!this.isSupportedRegion(regionCode)) return null;
    try {
      return getCountryCallingCode(regionCode);
    } catch {
      return null;
    }
  }

  /** A real, library-provided example mobile number for the region (national significant number only, e.g. "501234567" for SA) — never invented. */
  getExampleNumber(regionCode: string): string | null {
    if (!this.isSupportedRegion(regionCode)) return null;
    return (examples as Record<string, string | undefined>)[regionCode] ?? null;
  }

  private lengthErrorReason(
    rawInput: string,
    region?: string,
  ): PhoneErrorReason | null {
    const digitsOnly = rawInput.replace(/[^\d+]/g, '');
    if (!/\d/.test(digitsOnly)) return 'NOT_A_NUMBER';
    const result = validatePhoneNumberLength(
      rawInput,
      region as CountryCode | undefined,
    );
    if (!result) return null;
    if (result === 'TOO_SHORT') return 'TOO_SHORT';
    if (result === 'TOO_LONG') return 'TOO_LONG';
    if (result === 'INVALID_COUNTRY') return 'INVALID_COUNTRY';
    if (result === 'NOT_A_NUMBER') return 'NOT_A_NUMBER';
    return 'INVALID_LENGTH';
  }
}
