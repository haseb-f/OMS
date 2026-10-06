import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';
import { PASSWORD_POLICY } from './password-policy';

/** Cost used by create, reset, seed, and login — never hash twice, never mix libraries. */
export const PASSWORD_HASH_ROUNDS = 10;

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function normalizeUsername(value: string): string {
  return value.trim();
}

export function toNormalizedEmail(value: unknown): string {
  return typeof value === 'string' ? normalizeEmail(value) : '';
}

export function toNormalizedUsername(value: unknown): string {
  return typeof value === 'string' ? normalizeUsername(value) : '';
}

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, PASSWORD_HASH_ROUNDS);
}

export async function verifyPassword(
  plain: string,
  passwordHash: string,
): Promise<boolean> {
  return bcrypt.compare(plain, passwordHash);
}

/**
 * Cryptographically random temporary password satisfying `PASSWORD_POLICY`:
 * at least one upper-case, lower-case, digit and symbol from the policy's
 * unambiguous classes, every pick and the shuffle drawn with
 * `crypto.randomInt` (uniform — no modulo bias).
 */
export function generateTemporaryPassword(
  length: number = PASSWORD_POLICY.generatedLength,
): string {
  if (
    length < PASSWORD_POLICY.minLength ||
    length > PASSWORD_POLICY.maxLength
  ) {
    throw new Error(
      `Temporary passwords must be ${PASSWORD_POLICY.minLength}–${PASSWORD_POLICY.maxLength} characters.`,
    );
  }
  const { upper, lower, digits, symbols } = PASSWORD_POLICY.generatorClasses;
  const classes = [upper, lower, digits, symbols];
  const all = classes.join('');
  const pick = (alphabet: string) =>
    alphabet.charAt(crypto.randomInt(alphabet.length));
  const chars = classes.map(pick);
  while (chars.length < length) chars.push(pick(all));
  for (let i = chars.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    const current = chars[i];
    chars[i] = chars[j];
    chars[j] = current;
  }
  return chars.join('');
}
