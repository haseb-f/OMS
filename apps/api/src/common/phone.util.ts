import { parsePhoneNumberFromString } from 'libphonenumber-js';

/**
 * TASK-061 — Customer Master phone matching must never depend on exact
 * string formatting ("+966 50 123 4567" vs "00966501234567" vs
 * "0501234567" from the same person must all match one Customer). Reuses
 * `libphonenumber-js` (already a dependency of `@IsPhoneNumber()`) to parse
 * to E.164 for comparison; falls back to a digits-only comparison key when
 * the value doesn't parse as a valid phone number at all (still better than
 * an exact-string compare, and never throws on garbage input).
 */
export function normalizePhone(value?: string | null): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;

  const parsed = parsePhoneNumberFromString(trimmed);
  if (parsed?.isValid()) {
    return parsed.number; // E.164, e.g. "+966501234567"
  }

  const digitsOnly = trimmed.replace(/\D/g, '');
  return digitsOnly || null;
}
