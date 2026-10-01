import {
  parsePhoneNumberFromString,
  validatePhoneNumberLength,
  getCountryCallingCode,
  getCountries,
  type CountryCode,
  type PhoneNumber,
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
  /** "MOBILE" / "FIXED_LINE" / etc. — null with the `/min` metadata for most regions (type detection needs `/max`). */
  type: string | null;
  /**
   * True only when a `defaultRegion` was supplied AND the number belongs to
   * a DIFFERENT calling code (e.g. +20 while Saudi Arabia/+966 is selected).
   * A number of another region that shares the selected region's calling
   * code (+1 US/CA, +7 RU/KZ, +44 GB/GG/JE/IM) is NOT a mismatch — see
   * `sharedCallingCode`.
   */
  regionMismatch: boolean;
  /** Valid for a different region that shares the selected region's calling code — accepted, because that is the library's own determination from the leading digits. */
  sharedCallingCode: boolean;
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

const SUPPORTED_REGIONS = new Set<string>(getCountries());

const ARABIC_INDIC_ZERO = 0x0660;
const EXTENDED_ARABIC_INDIC_ZERO = 0x06f0;

/**
 * Arabic-Indic (U+0660–U+0669) and Extended Arabic-Indic / Persian
 * (U+06F0–U+06F9) digits → ASCII, full-width "＋" → "+", and the bidi/format
 * marks a copy from an RTL page or a chat app often carries (LRM/RLM,
 * LRE…RLO, LRI…PDI, NBSP, ZWSP) turned into spaces. Mirrors
 * `normalizePhoneDigits` in apps/api/src/common/phone/phone-number.service.ts.
 */
export function normalizePhoneDigits(rawInput: string): string {
  return rawInput
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - ARABIC_INDIC_ZERO))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - EXTENDED_ARABIC_INDIC_ZERO))
    .replace(/＋/g, "+")
    .replace(/[​‎‏‪-‮⁦-⁩ ]/g, " ");
}

/** Normalize digits, strip spreadsheet/paste separators (spaces, hyphens, dashes, parentheses, dots, slashes), turn a leading "00" into "+". Never invents a calling code. */
export function preparePhoneInput(rawInput: string): string {
  const stripped = normalizePhoneDigits(rawInput)
    .trim()
    .replace(/[\s\-‐-―()./]/g, "");
  if (stripped.startsWith("00")) return `+${stripped.slice(2)}`;
  return stripped;
}

export function isSupportedRegion(
  regionCode: string | null | undefined,
): regionCode is CountryCode {
  const normalized = regionCode?.trim().toUpperCase();
  return !!normalized && SUPPORTED_REGIONS.has(normalized);
}

export function getCallingCode(regionCode: string): string | null {
  if (!isSupportedRegion(regionCode)) return null;
  try {
    return getCountryCallingCode(regionCode.trim().toUpperCase() as CountryCode);
  } catch {
    return null;
  }
}

/** Documented Saudi Arabia mobile-number rule — see the mirrored, fully-commented version in apps/api/src/common/phone/phone-number.service.ts. */
const SAUDI_CALLING_CODE = "966";
const SAUDI_MOBILE_NATIONAL_PATTERN = /^5\d{8}$/;

function isSaudiRegionHint(regionHint: string | null | undefined): boolean {
  if (!regionHint) return false;
  const normalized = regionHint.trim().toUpperCase();
  return normalized === "SA" || normalized === "SAU";
}

function parseSaudiNationalFallback(
  prepared: string,
  rawRegionHint: string | null | undefined,
  resolvedRegion: CountryCode | undefined,
): PhoneNumber | undefined {
  if (resolvedRegion && resolvedRegion !== "SA") return undefined;
  if (!resolvedRegion && !isSaudiRegionHint(rawRegionHint)) return undefined;
  const withoutPlus = prepared.startsWith("+") ? prepared.slice(1) : prepared;
  let national = withoutPlus.replace(/\D/g, "");
  if (national.startsWith(SAUDI_CALLING_CODE)) national = national.slice(SAUDI_CALLING_CODE.length);
  if (national.startsWith("0")) national = national.slice(1);
  if (!SAUDI_MOBILE_NATIONAL_PATTERN.test(national)) return undefined;
  return parsePhoneNumberFromString(`+${SAUDI_CALLING_CODE}${national}`, "SA");
}

/**
 * Digits that already carry a calling code but no "+" ("966501234567").
 * With a selected region it's only accepted when that calling code IS the
 * selected region's (the "+966" addon is already showing — never duplicate
 * it); a bare digit string is never reinterpreted as a foreign number (a
 * mistyped Saudi "5012345678" must not become a Belize "+501…" number).
 * Without a region (spreadsheet/import, User.mobile) any calling code is
 * accepted, exactly as before.
 */
function parseInternationalWithoutPlus(
  prepared: string,
  region: CountryCode | undefined,
): PhoneNumber | undefined {
  if (prepared.startsWith("+") || !/^\d{8,15}$/.test(prepared)) return undefined;
  const candidate = parsePhoneNumberFromString(`+${prepared}`, region);
  if (!candidate?.isValid()) return undefined;
  if (region && candidate.countryCallingCode !== getCallingCode(region)) return undefined;
  return candidate;
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

/**
 * The ONE place the frontend understands phone numbers — every
 * `OMSPhoneInput` and every phone-carrying zod schema goes through this
 * instead of a hand-rolled regex. Mirrors `apps/api/src/common/phone/
 * phone-number.service.ts` exactly (same normalization, same parse order,
 * same error-reason codes, same mismatch rule) so frontend and backend can
 * never disagree about whether a number is valid — only the language of the
 * message differs.
 *
 * Uses the `/min` metadata build (libphonenumber-js 1.13.9): `isValid()`
 * checks the per-country possible lengths plus the loose national-number
 * pattern; strict per-type digit patterns and `getType()` need `/max`. Both
 * apps use the same `/min` set on purpose — see
 * specs/usability-financial-reports/phone-field.md.
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
    sharedCallingCode: false,
    errorReason: "EMPTY",
  };
  const trimmed = rawInput?.trim();
  if (!trimmed) return empty;

  const prepared = preparePhoneInput(trimmed);
  if (!prepared) return empty;
  const normalizedRegionInput = defaultRegion?.trim().toUpperCase();
  const region = isSupportedRegion(normalizedRegionInput)
    ? (normalizedRegionInput as CountryCode)
    : undefined;

  // Saudi fallback first: a bare Saudi national number can structurally
  // parse as another country once "+" is prepended (see the API mirror).
  // A region parse that is structurally fine but invalid still gets the
  // same-calling-code retry before it's reported as the (invalid) result.
  const regionParsed = parsePhoneNumberFromString(prepared, region);
  const parsed =
    parseSaudiNationalFallback(prepared, defaultRegion, region) ??
    (regionParsed?.isValid() ? regionParsed : undefined) ??
    parseInternationalWithoutPlus(prepared, region) ??
    regionParsed;

  if (!parsed) {
    return { ...empty, errorReason: lengthErrorReason(prepared, region) ?? "NOT_A_NUMBER" };
  }

  const isValid = parsed.isValid();
  const detectedRegion = (parsed.country ?? null) as CountryCode | null;
  const regionCallingCode = region ? getCallingCode(region) : null;
  const sameCode = !!regionCallingCode && parsed.countryCallingCode === regionCallingCode;
  const regionMismatch = !!region && !!parsed.countryCallingCode && !sameCode;
  const sharedCallingCode = !!region && !!detectedRegion && detectedRegion !== region && sameCode;

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
      errorReason: lengthErrorReason(prepared, detectedRegion ?? region) ?? "INVALID_PATTERN",
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

export function normalizeToE164(
  rawInput: string | null | undefined,
  defaultRegion?: string | null,
): string | null {
  return parsePhone(rawInput, defaultRegion).e164;
}

/** Library example (national significant number) — used for placeholders and error hints only, never as a value. */
export function getExampleNumber(regionCode: string): string | null {
  if (!isSupportedRegion(regionCode)) return null;
  return (examples as Record<string, string | undefined>)[regionCode.trim().toUpperCase()] ?? null;
}

function formatInternational(e164: string): string | null {
  return parsePhoneNumberFromString(e164)?.formatInternational() ?? null;
}

/** "+966 50 123 4567" → "50 123 4567": the grouped national significant number without the calling code the "+CC" addon already shows (and without a trunk "0", which would read wrong right after "+966"). */
function stripCallingCode(international: string, callingCode: string): string {
  const prefix = `+${callingCode}`;
  return international.startsWith(prefix)
    ? international.slice(prefix.length).trim()
    : international;
}

/** Placeholder for the national-number input: the library's example, grouped the way the country writes it (e.g. SA "51 234 5678", GB "7400 123456"). Placeholder only — never a value. */
export function getPhonePlaceholder(regionCode: string | null | undefined): string | null {
  if (!regionCode) return null;
  const example = getExampleNumber(regionCode);
  const callingCode = getCallingCode(regionCode);
  if (!example || !callingCode) return null;
  const international = formatInternational(`+${callingCode}${example}`);
  return international ? stripCallingCode(international, callingCode) : example;
}

/**
 * Read-only display of a stored phone value: E.164 (or any parseable value)
 * → "+966 50 123 4567"; anything the library can't parse (legacy free-text
 * rows) is shown exactly as stored — display never rewrites data.
 */
export function formatPhoneForDisplay(
  value: string | null | undefined,
  defaultRegion?: string | null,
): string {
  const raw = value?.trim() ?? "";
  if (!raw) return "";
  const result = parsePhone(raw, defaultRegion);
  if (!result.isValid || !result.e164) return raw;
  return formatInternational(result.e164) ?? raw;
}

/**
 * What `OMSPhoneInput`'s editable box shows for a committed value next to
 * the "+CC" addon: the grouped national number when the value belongs to the
 * addon's calling code (never the code twice), the full international form
 * when it belongs to another calling code (so the conflict stays visible and
 * is never silently reinterpreted), or the raw text when it isn't valid yet.
 */
export function phoneInputDisplayValue(
  value: string | null | undefined,
  regionCode: string | null | undefined,
): string {
  const raw = value ?? "";
  if (!raw.trim()) return raw;
  const result = parsePhone(raw, regionCode);
  if (!result.isValid || !result.e164 || !result.callingCode) return raw;
  const international = formatInternational(result.e164);
  if (!international) return raw;
  const addonCallingCode = regionCode ? getCallingCode(regionCode) : null;
  if (addonCallingCode && result.callingCode === addonCallingCode) {
    return stripCallingCode(international, addonCallingCode);
  }
  return international;
}

export type PastedPhoneResolution =
  /** Same calling code as the selected country — show the national part, commit E.164. */
  | { kind: "national"; display: string; e164: string }
  /** A valid number of ANOTHER calling code — committed as-is with the conflict surfaced; the country is never switched silently. */
  | { kind: "foreign"; display: string; e164: string; detectedRegion: CountryCode | null }
  /** Not a complete valid number — the browser pastes the text normally. */
  | { kind: "raw" };

/** Resolves a pasted full number (`+966…`, `00966…`, `966…`, Arabic digits) against the selected country. */
export function resolvePastedPhone(
  pasted: string,
  regionCode: string | null | undefined,
): PastedPhoneResolution {
  const prepared = preparePhoneInput(pasted);
  if (prepared.replace(/\D/g, "").length < 6) return { kind: "raw" };
  const result = parsePhone(prepared, regionCode);
  if (!result.isValid || !result.e164) return { kind: "raw" };
  const display = phoneInputDisplayValue(result.e164, regionCode);
  if (result.regionMismatch) {
    return { kind: "foreign", display, e164: result.e164, detectedRegion: result.detectedRegion };
  }
  return { kind: "national", display, e164: result.e164 };
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
 * once and cached at module scope.
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

/** Best-effort ISO2 guess from a number's own "+"/"00" prefix — used to detect a foreign number, never to silently switch the selected country. */
export function detectRegionFromInput(rawInput: string): CountryCode | null {
  const prepared = preparePhoneInput(rawInput);
  if (!prepared.startsWith("+")) return null;
  const parsed = parsePhoneNumberFromString(prepared);
  return (parsed?.country as CountryCode | undefined) ?? null;
}

/**
 * Owner decision O2 (2026-10-01): every phone input defaults to Saudi Arabia
 * (+966) unless the user picks another country. Neither the last-used
 * country nor the browser region influences the default of a new entry.
 */
export const DEFAULT_PHONE_COUNTRY = "SA" satisfies CountryCode;

/**
 * Default phone country of a new entry — Saudi Arabia, when the form offers
 * it (`available` = the form's own country codes; omit to allow any).
 */
export function defaultPhoneCountry(available?: readonly string[]): string | null {
  if (!available) return DEFAULT_PHONE_COUNTRY;
  return available.some((code) => code.toUpperCase() === DEFAULT_PHONE_COUNTRY)
    ? DEFAULT_PHONE_COUNTRY
    : null;
}

/** The country a phone field works with: the selected one, else the default (O2). */
export function phoneCountryOrDefault(countryCode: string | null | undefined): string {
  return countryCode?.trim() ? countryCode : DEFAULT_PHONE_COUNTRY;
}
