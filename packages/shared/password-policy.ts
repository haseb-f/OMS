/**
 * The ONE password policy of OMS (R13 A2) — every password rule in the web
 * forms and the API DTOs reads these numbers instead of repeating them.
 *
 * The API (CommonJS, built by `nest build`) cannot import this package at run
 * time, so `apps/api/src/auth/password-policy.ts` mirrors it and a parity spec
 * (`password-policy.spec.ts`) fails the build the moment the two differ.
 */
export const PASSWORD_POLICY = {
  /** Shortest password accepted anywhere (create, reset, change). */
  minLength: 8,
  /** Longest password accepted anywhere. */
  maxLength: 200,
  /** Length of a password suggested by the generator. */
  generatedLength: 14,
  /**
   * Character classes of a generated password — at least one of each. No
   * look-alikes (0/O/o, 1/l/I), no quotes, backslash or space, so a password
   * read aloud or copied from a screen is never mistyped.
   */
  generatorClasses: {
    upper: "ABCDEFGHJKLMNPQRSTUVWXYZ",
    lower: "abcdefghijkmnpqrstuvwxyz",
    digits: "23456789",
    symbols: "!@#$%&*?-_=+",
  },
} as const;

export type PasswordGeneratorClass = keyof typeof PASSWORD_POLICY.generatorClasses;

/** Fills the array with cryptographically secure random values (`crypto.getRandomValues`). */
export type SecureRandomFill = (array: Uint32Array) => Uint32Array;

const UINT32_RANGE = 0x1_0000_0000;

/**
 * Uniform integer in [0, bound) from a secure source — rejection sampling, so
 * no value is more likely than another (no modulo bias).
 */
export function secureRandomIndex(bound: number, fill: SecureRandomFill): number {
  if (!Number.isInteger(bound) || bound <= 0 || bound > UINT32_RANGE) {
    throw new RangeError("bound must be an integer in 1..2^32");
  }
  // Largest multiple of `bound` that fits in 32 bits; values at or above it are redrawn.
  const limit = UINT32_RANGE - (UINT32_RANGE % bound);
  const buffer = new Uint32Array(1);
  for (;;) {
    fill(buffer);
    const value = buffer[0] ?? 0;
    if (value < limit) return value % bound;
  }
}

/**
 * A random password that satisfies `PASSWORD_POLICY`: `length` characters
 * (default 14), at least one upper-case letter, lower-case letter, digit and
 * symbol, drawn uniformly and shuffled (Fisher–Yates) with a secure source.
 * The caller supplies the source (`crypto.getRandomValues` in the browser and
 * in Node), keeping this module free of any platform dependency.
 */
export function generatePassword(
  fill: SecureRandomFill,
  length: number = PASSWORD_POLICY.generatedLength,
): string {
  const { upper, lower, digits, symbols } = PASSWORD_POLICY.generatorClasses;
  const classes = [upper, lower, digits, symbols];
  if (length < Math.max(PASSWORD_POLICY.minLength, classes.length)) {
    throw new RangeError(
      `Generated passwords need at least ${PASSWORD_POLICY.minLength} characters.`,
    );
  }
  if (length > PASSWORD_POLICY.maxLength) {
    throw new RangeError(
      `Generated passwords are at most ${PASSWORD_POLICY.maxLength} characters.`,
    );
  }
  const all = classes.join("");
  const pick = (alphabet: string) => alphabet.charAt(secureRandomIndex(alphabet.length, fill));
  const chars = classes.map(pick);
  while (chars.length < length) chars.push(pick(all));
  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = secureRandomIndex(i + 1, fill);
    const current = chars[i] as string;
    chars[i] = chars[j] as string;
    chars[j] = current;
  }
  return chars.join("");
}

/** Whether `password` meets the policy's length rule (what every form and DTO checks). */
export function meetsPasswordPolicy(password: string): boolean {
  return (
    password.length >= PASSWORD_POLICY.minLength && password.length <= PASSWORD_POLICY.maxLength
  );
}
