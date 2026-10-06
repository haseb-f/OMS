import { PASSWORD_POLICY, generatePassword } from "@oms/shared";

export { PASSWORD_POLICY };

/**
 * A suggested password (R13 A2): 14 characters from the shared policy's
 * unambiguous classes, at least one upper-case, lower-case, digit and symbol,
 * drawn with the browser's `crypto.getRandomValues` (rejection sampling, no
 * modulo bias). Never logged, never sent anywhere but the form it fills.
 */
export function generateSecurePassword(): string {
  return generatePassword((array) => globalThis.crypto.getRandomValues(array));
}
