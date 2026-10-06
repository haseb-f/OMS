/**
 * Mirror of `PASSWORD_POLICY` in `packages/shared/password-policy.ts` (R13 A2)
 * — the ONE password policy. The API is CommonJS built by `nest build` and
 * cannot import the workspace package at run time, so the values live here
 * once for every DTO and service; `password-policy.spec.ts` fails the moment
 * this copy and the shared one differ. Change both together.
 */
export const PASSWORD_POLICY = {
  minLength: 8,
  maxLength: 200,
  generatedLength: 14,
  generatorClasses: {
    upper: 'ABCDEFGHJKLMNPQRSTUVWXYZ',
    lower: 'abcdefghijkmnpqrstuvwxyz',
    digits: '23456789',
    symbols: '!@#$%&*?-_=+',
  },
} as const;

/** The message every password-length rule uses. */
export const PASSWORD_LENGTH_MESSAGE = `Password must be ${PASSWORD_POLICY.minLength}–${PASSWORD_POLICY.maxLength} characters.`;

export function meetsPasswordPolicy(password: string): boolean {
  return (
    password.length >= PASSWORD_POLICY.minLength &&
    password.length <= PASSWORD_POLICY.maxLength
  );
}
