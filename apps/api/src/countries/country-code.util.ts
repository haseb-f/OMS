/** ISO 3166-1 alpha-2: exactly two Latin letters A–Z. */
const ISO_ALPHA2_PATTERN = /^[A-Z]{2}$/;
/** ISO 3166-1 alpha-3: exactly three Latin letters A–Z. */
const ISO_ALPHA3_PATTERN = /^[A-Z]{3}$/;

export const INVALID_COUNTRY_CODE_MESSAGE =
  'رمز الدولة يجب أن يكون رمز ISO 3166-1 من حرفين لاتينيين فقط (A–Z)، مثل SA أو EG.';
export const INVALID_COUNTRY_ISO3_MESSAGE =
  'رمز ISO3 يجب أن يكون ثلاثة أحرف لاتينية فقط (A–Z)، مثل SAU.';

/** Trims and upper-cases — the only normalization applied; anything still outside A–Z (e.g. Arabic diacritics, digits) is rejected, never silently stripped. */
export function normalizeIsoCode(value: string): string {
  return value.trim().toUpperCase();
}

export function isValidCountryCode(normalized: string): boolean {
  return ISO_ALPHA2_PATTERN.test(normalized);
}

export function isValidCountryIso3(normalized: string): boolean {
  return ISO_ALPHA3_PATTERN.test(normalized);
}
