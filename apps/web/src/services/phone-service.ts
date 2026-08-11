import {
  parsePhoneNumberFromString,
  validatePhoneNumberLength,
  getCountryCallingCode,
  getCountries,
  type CountryCode,
} from "libphonenumber-js/min";
import examples from "libphonenumber-js/examples.mobile.json";

export type PhoneErrorReason =
  | "EMPTY"
  | "NOT_A_NUMBER"
  | "TOO_SHORT"
  | "TOO_LONG"
  | "INVALID_LENGTH"
  | "INVALID_COUNTRY"
  | "INVALID_PATTERN";

export interface PhoneParseResult {
  isValid: boolean;
  /** Canonical storage format — always set when `isValid`. */
  e164: string | null;
  nationalNumber: string | null;
  callingCode: string | null;
  /** The ISO2 region libphonenumber-js actually detected the number as belonging to — can differ from `defaultRegion` (e.g. a "+20..." number typed while Saudi Arabia is selected). */
  detectedRegion: CountryCode | null;
  /** "MOBILE" / "FIXED_LINE" / "FIXED_LINE_OR_MOBILE" / etc. — null when the region's metadata can't distinguish types. */
  type: string | null;
  /** True only when a `defaultRegion` was supplied AND the number parsed as belonging to a different region. */
  regionMismatch: boolean;
  errorReason: PhoneErrorReason | null;
}

export interface CountryPhoneMetadata {
  iso2: CountryCode;
  nameAr: string;
  nameEn: string;
  callingCode: string;
  flag: string;
  /** A real example mobile number's national significant number (e.g. "501234567" for SA) — from the library's own metadata, never invented. */
  example: string | null;
}

/**
 * The ONE place the frontend understands phone numbers — every
 * `OMSPhoneInput` and every phone-carrying zod schema goes through this
 * instead of a hand-rolled regex. Mirrors `apps/api/src/common/phone/
 * phone-number.service.ts` exactly (same error-reason codes, same
 * "region-aware but never double-prepends an already-international number"
 * behavior) so frontend and backend can never disagree about whether a
 * number is valid — only the language of the message differs.
 *
 * Uses the `/min` metadata build (smaller bundle, still every country) —
 * see `libphonenumber-js`'s own size-tiered exports; there's no need for
 * the full `/max` build's extra features (find-numbers-in-text, etc.) here.
 */
export function parsePhone(
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
    errorReason: "EMPTY",
  };
  const trimmed = rawInput?.trim();
  if (!trimmed) return empty;

  const region = isSupportedRegion(defaultRegion) ? defaultRegion : undefined;
  const parsed = parsePhoneNumberFromString(trimmed, region);

  if (!parsed) {
    return { ...empty, errorReason: lengthErrorReason(trimmed, region) ?? "NOT_A_NUMBER" };
  }

  const isValid = parsed.isValid();
  const detectedRegion = (parsed.country ?? null) as CountryCode | null;
  const regionMismatch = !!region && !!detectedRegion && detectedRegion !== region;

  if (!isValid) {
    return {
      isValid: false,
      e164: null,
      nationalNumber: parsed.nationalNumber ?? null,
      callingCode: parsed.countryCallingCode ?? null,
      detectedRegion,
      type: null,
      regionMismatch,
      errorReason: lengthErrorReason(trimmed, detectedRegion ?? region) ?? "INVALID_PATTERN",
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

export function normalizeToE164(
  rawInput: string | null | undefined,
  defaultRegion?: string | null,
): string | null {
  return parsePhone(rawInput, defaultRegion).e164;
}

function lengthErrorReason(rawInput: string, region?: string): PhoneErrorReason | null {
  const digitsOnly = rawInput.replace(/[^\d+]/g, "");
  if (!/\d/.test(digitsOnly)) return "NOT_A_NUMBER";
  const result = validatePhoneNumberLength(rawInput, region as CountryCode | undefined);
  if (!result) return null;
  if (result === "TOO_SHORT") return "TOO_SHORT";
  if (result === "TOO_LONG") return "TOO_LONG";
  if (result === "INVALID_COUNTRY") return "INVALID_COUNTRY";
  if (result === "NOT_A_NUMBER") return "NOT_A_NUMBER";
  return "INVALID_LENGTH";
}

const SUPPORTED_REGIONS = new Set<string>(getCountries());

export function isSupportedRegion(
  regionCode: string | null | undefined,
): regionCode is CountryCode {
  return !!regionCode && SUPPORTED_REGIONS.has(regionCode);
}

export function getCallingCode(regionCode: string): string | null {
  if (!isSupportedRegion(regionCode)) return null;
  try {
    return getCountryCallingCode(regionCode);
  } catch {
    return null;
  }
}

export function getExampleNumber(regionCode: string): string | null {
  if (!isSupportedRegion(regionCode)) return null;
  return (examples as Record<string, string | undefined>)[regionCode] ?? null;
}

/** Regional-indicator flag emoji, computed from the ISO2 code — never a hardcoded per-country list/image. */
function flagEmoji(iso2: string): string {
  return [...iso2.toUpperCase()]
    .map((char) => String.fromCodePoint(127397 + char.charCodeAt(0)))
    .join("");
}

let cachedCountryList: CountryPhoneMetadata[] | null = null;

/**
 * Every country the phone system supports, with Arabic/English display
 * names, calling code, flag, and a real example number — all *computed*
 * (from `libphonenumber-js` metadata + the native `Intl.DisplayNames` API),
 * never a hand-maintained country list living in a second place. Computed
 * once and cached at module scope (Part 25 — country search must be fast
 * and never re-derive this on every render/keystroke).
 */
export function getAllCountryPhoneMetadata(): CountryPhoneMetadata[] {
  if (cachedCountryList) return cachedCountryList;

  const namesAr = new Intl.DisplayNames(["ar"], { type: "region" });
  const namesEn = new Intl.DisplayNames(["en"], { type: "region" });

  cachedCountryList = getCountries()
    .map((iso2): CountryPhoneMetadata | null => {
      const callingCode = getCallingCode(iso2);
      if (!callingCode) return null;
      return {
        iso2,
        nameAr: namesAr.of(iso2) ?? iso2,
        nameEn: namesEn.of(iso2) ?? iso2,
        callingCode,
        flag: flagEmoji(iso2),
        example: getExampleNumber(iso2),
      };
    })
    .filter((c): c is CountryPhoneMetadata => !!c)
    .sort((a, b) => a.nameAr.localeCompare(b.nameAr, "ar"));

  return cachedCountryList;
}

export function getCountryPhoneMetadata(regionCode: string): CountryPhoneMetadata | null {
  return getAllCountryPhoneMetadata().find((c) => c.iso2 === regionCode) ?? null;
}

/** Best-effort ISO2 guess from a number's own "+" prefix — used to detect "user typed +20... while Saudi Arabia was selected" (Part 19), never to silently switch the selected country. */
export function detectRegionFromInput(rawInput: string): CountryCode | null {
  if (!rawInput.trim().startsWith("+")) return null;
  const parsed = parsePhoneNumberFromString(rawInput.trim());
  return (parsed?.country as CountryCode | undefined) ?? null;
}
