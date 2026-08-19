import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';

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

function pickChar(alphabet: string, index: number): string {
  const char = alphabet[index % alphabet.length];
  if (!char) {
    throw new Error('Password alphabet is empty.');
  }
  return char;
}

/**
 * Cryptographically random temporary password: mixed case, digit, and
 * symbol, length ≥ 8 so it satisfies the same rule as a manually entered
 * password. Unambiguous alphabet (no 0/O, 1/l/I).
 */
export function generateTemporaryPassword(length = 12): string {
  if (length < 8) {
    throw new Error('Temporary passwords must be at least 8 characters.');
  }
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghijkmnopqrstuvwxyz';
  const digits = '23456789';
  const symbols = '!@#$%';
  const all = `${upper}${lower}${digits}${symbols}`;
  const bytes = crypto.randomBytes(length);
  const chars: string[] = [
    pickChar(upper, bytes[0]),
    pickChar(lower, bytes[1]),
    pickChar(digits, bytes[2]),
    pickChar(symbols, bytes[3]),
  ];
  for (let i = 4; i < length; i++) {
    chars.push(pickChar(all, bytes[i]));
  }
  for (let i = chars.length - 1; i > 0; i--) {
    const j = bytes[i] % (i + 1);
    const current = chars[i];
    const swap = chars[j];
    if (!current || !swap) continue;
    chars[i] = swap;
    chars[j] = current;
  }
  return chars.join('');
}
