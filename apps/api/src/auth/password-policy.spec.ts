import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PASSWORD_POLICY } from './password-policy';
import { generateTemporaryPassword } from './password.util';

/** The shared package owns the policy; this API copy must match it exactly. */
function sharedPolicySource(): string {
  return readFileSync(
    resolve(__dirname, '../../../../packages/shared/password-policy.ts'),
    'utf8',
  );
}

function sharedNumber(source: string, key: string): number {
  const match = source.match(new RegExp(`\\b${key}:\\s*(\\d+)`));
  if (!match) throw new Error(`${key} not found in the shared policy`);
  return Number(match[1]);
}

function sharedClass(source: string, key: string): string {
  const match = source.match(new RegExp(`\\b${key}:\\s*"([^"]*)"`));
  if (!match) throw new Error(`${key} not found in the shared policy`);
  return match[1];
}

describe('PASSWORD_POLICY (R13 A2)', () => {
  it('mirrors packages/shared/password-policy.ts exactly', () => {
    const source = sharedPolicySource();
    expect(PASSWORD_POLICY.minLength).toBe(sharedNumber(source, 'minLength'));
    expect(PASSWORD_POLICY.maxLength).toBe(sharedNumber(source, 'maxLength'));
    expect(PASSWORD_POLICY.generatedLength).toBe(
      sharedNumber(source, 'generatedLength'),
    );
    for (const key of ['upper', 'lower', 'digits', 'symbols'] as const) {
      expect(PASSWORD_POLICY.generatorClasses[key]).toBe(
        sharedClass(source, key),
      );
    }
  });

  it('every generated temporary password satisfies the policy', () => {
    const { upper, lower, digits, symbols } = PASSWORD_POLICY.generatorClasses;
    const allowed = new Set([...upper, ...lower, ...digits, ...symbols]);
    const has = (password: string, alphabet: string) =>
      [...password].some((char) => alphabet.includes(char));
    for (let i = 0; i < 500; i++) {
      const password = generateTemporaryPassword();
      expect(password).toHaveLength(PASSWORD_POLICY.generatedLength);
      expect(has(password, upper)).toBe(true);
      expect(has(password, lower)).toBe(true);
      expect(has(password, digits)).toBe(true);
      expect(has(password, symbols)).toBe(true);
      expect([...password].every((char) => allowed.has(char))).toBe(true);
    }
  });

  it('refuses a length outside the policy', () => {
    expect(() =>
      generateTemporaryPassword(PASSWORD_POLICY.minLength - 1),
    ).toThrow();
    expect(() =>
      generateTemporaryPassword(PASSWORD_POLICY.maxLength + 1),
    ).toThrow();
  });
});
