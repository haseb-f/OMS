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
  /**
   * True only when a `defaultRegion` was supplied AND the number belongs to a
   * DIFFERENT calling code (+20 while Saudi Arabia/+966 is selected). A
   * number of another region sharing the selected region's calling code
   * (+1 US/CA, +7 RU/KZ, +44 GB/GG/JE/IM) is not a mismatch — see
   * `sharedCallingCode`.
   */
  regionMismatch: boolean;
  /** Valid for a different region that shares the selected region's calling code — accepted, as the library's own determination from the leading digits. */
  sharedCallingCode: boolean;
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
 * Primary markets, in order — the regions tried for a number typed WITHOUT a
 * usable country (a bare national "0501234567", "01063233211"). One list for
 * every lookup/identity path (partner phone keys, duplicate check, advanced
 * lookup) so they can never disagree.
 */
export const PHONE_FALLBACK_REGIONS = ['SA', 'EG', 'AE'] as const;

const ARABIC_INDIC_ZERO = 0x0660;
const EXTENDED_ARABIC_INDIC_ZERO = 0x06f0;

/**
 * Arabic-Indic (U+0660–U+0669) and Extended Arabic-Indic / Persian
 * (U+06F0–U+06F9) digits → ASCII, full-width "＋" → "+", and bidi/format
 * marks (LRM/RLM, LRE…RLO, LRI…PDI, NBSP, ZWSP) turned into spaces. Mirrors
 * `normalizePhoneDigits` in apps/web/src/services/phone-service.ts so the
 * server accepts exactly what the form accepted.
 */
export function normalizePhoneDigits(rawInput: string): string {
  return rawInput
    .replace(/[\u0660-\u0669]/g, (d) =>
      String(d.charCodeAt(0) - ARABIC_INDIC_ZERO),
    )
    .replace(/[\u06f0-\u06f9]/g, (d) =>
      String(d.charCodeAt(0) - EXTENDED_ARABIC_INDIC_ZERO),
    )
    .replace(/\uff0b/g, '+')
    .replace(/[\u200b\u200e\u200f\u202a-\u202e\u2066-\u2069\u00a0]/g, ' ');
}

/**
 * Normalize digits, strip separators operators commonly type or paste
 * (spaces, hyphens, dashes, parentheses, dots, slashes), then turn a leading
 * "00" international prefix into "+". Does not invent a country calling
 * code — `parse()` still uses `defaultRegion` (or an embedded "+") to decide
 * the actual region.
 */
export function preparePhoneInput(rawInput: string): string {
  const stripped = normalizePhoneDigits(rawInput)
    .trim()
    .replace(/[\s\-\u2010-\u2015()./]/g, '');
  if (stripped.startsWith('00')) return `+${stripped.slice(2)}`;
  return stripped;
}

/**
 * Digit-only candidate representations of a free-text SEARCH term, for
 * matching a phone stored in E.164 (`+966564345678`) or in a legacy local
 * format regardless of how the operator typed it: Arabic-Indic digits, spaces
 * and punctuation, a trunk "0", an international "00" or "+", with or without
 * the calling code. Country-agnostic on purpose (a search box has no per-row
 * country): it only strips a leading "00" or one trunk "0" so the remaining
 * digits still land as a `contains` substring. Under 6 digits → `[]` (too
 * short to be a phone fragment). Pure, so list services can use it without
 * injecting the phone service.
 */
export function phoneSearchCandidates(
  rawSearch: string | null | undefined,
): string[] {
  const digitsOnly = normalizePhoneDigits(rawSearch ?? '').replace(/\D/g, '');
  if (digitsOnly.length < 6) return [];
  const candidates = new Set<string>([digitsOnly]);
  if (digitsOnly.startsWith('00') && digitsOnly.length > 2) {
    candidates.add(digitsOnly.slice(2));
  }
  if (digitsOnly.startsWith('0') && digitsOnly.length > 1) {
    candidates.add(digitsOnly.slice(1));
  }
  return [...candidates].filter((candidate) => candidate.length >= 6);
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
 * A bare national number typed without a calling code that is valid in more
 * than one fallback market (e.g. 05… is a mobile in both SA and AE): saving it
 * must never guess — the user chooses the calling code.
 */
export function ambiguousPhoneMessage(readings: readonly string[]): string {
  return `This number is valid in more than one country (${readings.join(', ')}) — choose its calling code or enter it with the country code (+…).`;
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
      sharedCallingCode: false,
      errorReason: 'EMPTY',
    };
    const trimmed = rawInput?.trim();
    if (!trimmed) return empty;

    const prepared = preparePhoneInput(trimmed);
    if (!prepared) return empty;
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
    // A region parse that is structurally fine but invalid still gets the
    // same-calling-code retry (`966501234567` with SA) before it is reported
    // as the (invalid) result — same order as the web `parsePhone`.
    const regionParsed = parsePhoneNumberFromString(prepared, region);
    const parsed =
      this.parseSaudiNationalFallback(prepared, defaultRegion, region) ??
      (regionParsed?.isValid() ? regionParsed : undefined) ??
      this.parseInternationalWithoutPlus(prepared, region) ??
      regionParsed;

    if (!parsed) {
      return {
        ...empty,
        errorReason: this.lengthErrorReason(prepared, region) ?? 'NOT_A_NUMBER',
      };
    }

    const isValid = parsed.isValid();
    const detectedRegion = parsed.country ?? null;
    const regionCallingCode = region ? this.getCallingCode(region) : null;
    const sameCode =
      !!regionCallingCode && parsed.countryCallingCode === regionCallingCode;
    const regionMismatch = !!region && !!parsed.countryCallingCode && !sameCode;
    const sharedCallingCode =
      !!region && !!detectedRegion && detectedRegion !== region && sameCode;

    if (!isValid) {
      return {
        isValid: false,
        e164: null,
        nationalNumber: parsed.nationalNumber ?? null,
        callingCode: parsed.countryCallingCode ?? null,
        detectedRegion,
        type: null,
        regionMismatch: regionMismatch && !!detectedRegion,
        sharedCallingCode: false,
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
      sharedCallingCode,
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
    const digits = withoutPlus.replace(/\D/g, '');
    let national = digits;
    if (national.startsWith(SAUDI_CALLING_CODE)) {
      national = national.slice(SAUDI_CALLING_CODE.length);
    }
    if (national.startsWith('0')) {
      national = national.slice(1);
    }
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
   * the selected region's code onto a local number. With a region the
   * candidate must carry THAT region's calling code: a bare digit string is
   * never reinterpreted as a foreign number (a mistyped Saudi "5012345678"
   * must not become Belize "+501…"). Without a region any calling code is
   * accepted.
   */
  private parseInternationalWithoutPlus(
    prepared: string,
    region?: CountryCode,
  ) {
    if (prepared.startsWith('+') || !/^\d{8,15}$/.test(prepared))
      return undefined;
    const candidate = parsePhoneNumberFromString(`+${prepared}`, region);
    if (!candidate?.isValid()) return undefined;
    if (region && candidate.countryCallingCode !== this.getCallingCode(region))
      return undefined;
    return candidate;
  }

  /**
   * Digit-only candidate representations of a free-text search term, for
   * matching a phone number stored in E.164 (`+966564345678`) regardless
   * of how the operator typed it — local trunk zero, "00" international
   * prefix, with or without "+", with or without the calling code. A
   * search box has no per-row country context to `parse()` against (that
   * needs a selected Country), so this stays deliberately country-agnostic:
   * it just strips a leading "00" or a single leading trunk "0" so the
   * remaining digits still land as a `contains` substring of the stored
   * E.164 value, whichever country it belongs to.
   *
   * Returns `[]` for anything under 6 digits — too short to plausibly be a
   * phone fragment, so a short numeric order-id search term doesn't
   * spuriously widen into a phone match.
   */
  searchCandidates(rawSearch: string | null | undefined): string[] {
    return phoneSearchCandidates(rawSearch);
  }

  /**
   * Every E.164 a typed phone can validly mean — the ONE identity matching path.
   * The country the user chose (the form's phone country) is authoritative when
   * the number is valid in it: only that reading is returned. Otherwise the
   * number on its own ("+…", "00…", "966…", Arabic digits), otherwise every
   * valid reading in the primary markets for a bare national number (a number
   * can be valid in two markets and the customer must be found under whichever
   * it was saved as). Matching is always on a full valid E.164 — never a suffix
   * or a digit fragment — so a local number typed under the wrong default
   * country still finds its customer without matching an unrelated one.
   *
   * `narrow` keeps only the first reading (Create/Update guards, where a false
   * positive would block a legitimate save).
   */
  lookupCandidates(
    rawInput: string | null | undefined,
    regionHint?: string | null,
    narrow = false,
  ): string[] {
    if (!rawInput?.trim()) return [];
    const hinted = regionHint
      ? this.normalizeToE164(rawInput, regionHint)
      : null;
    if (hinted) return [hinted];
    const international = this.normalizeToE164(rawInput, null);
    if (international) return [international];
    const out = new Set<string>();
    for (const region of PHONE_FALLBACK_REGIONS) {
      const e164 = this.normalizeToE164(rawInput, region);
      if (e164) out.add(e164);
      if (narrow && out.size > 0) break;
    }
    return [...out];
  }

  /**
   * Saving a phone with no chosen country: the one valid reading (`e164`),
   * or — when the number reads validly in more than one fallback market —
   * `e164: null` and every distinct reading in `ambiguous`, so the caller
   * asks for the calling code instead of silently picking the first market.
   */
  resolveWithoutCountry(rawInput: string | null | undefined): {
    e164: string | null;
    ambiguous: string[];
  } {
    const readings = this.lookupCandidates(rawInput, null);
    if (readings.length > 1) return { e164: null, ambiguous: readings };
    return { e164: readings[0] ?? null, ambiguous: [] };
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
