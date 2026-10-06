import { afterEach, describe, expect, it, vi } from "vitest";
import { secureRandomIndex } from "@oms/shared";
import { PASSWORD_POLICY, generateSecurePassword } from "./password-generator";

const { upper, lower, digits, symbols } = PASSWORD_POLICY.generatorClasses;
const has = (password: string, alphabet: string) =>
  [...password].some((char) => alphabet.includes(char));

afterEach(() => vi.restoreAllMocks());

describe("generateSecurePassword (R13 A2)", () => {
  it("every sample satisfies the policy: 14 chars, upper + lower + digit + symbol, allowed characters only", () => {
    const allowed = new Set([...upper, ...lower, ...digits, ...symbols]);
    for (let i = 0; i < 2000; i += 1) {
      const password = generateSecurePassword();
      expect(password).toHaveLength(PASSWORD_POLICY.generatedLength);
      expect(password.length).toBeGreaterThanOrEqual(PASSWORD_POLICY.minLength);
      expect(password.length).toBeLessThanOrEqual(PASSWORD_POLICY.maxLength);
      expect(has(password, upper)).toBe(true);
      expect(has(password, lower)).toBe(true);
      expect(has(password, digits)).toBe(true);
      expect(has(password, symbols)).toBe(true);
      expect([...password].every((char) => allowed.has(char))).toBe(true);
    }
  });

  it("never uses look-alike characters", () => {
    for (let i = 0; i < 500; i += 1) {
      expect(generateSecurePassword()).not.toMatch(/[0O1lIo"'`\\\s]/);
    }
  });

  it("draws from crypto.getRandomValues", () => {
    const spy = vi.spyOn(globalThis.crypto, "getRandomValues");
    generateSecurePassword();
    expect(spy).toHaveBeenCalled();
  });

  it("is not repetitive (distribution sanity)", () => {
    const samples = new Set(Array.from({ length: 500 }, () => generateSecurePassword()));
    expect(samples.size).toBe(500);
    // Every character of the full alphabet shows up across many samples.
    const seen = new Set([...Array.from({ length: 500 }, () => generateSecurePassword()).join("")]);
    expect(seen.size).toBe(upper.length + lower.length + digits.length + symbols.length);
  });
});

describe("secureRandomIndex — rejection sampling", () => {
  it("redraws values in the biased tail instead of folding them with modulo", () => {
    // bound 3: limit = 2^32 - (2^32 % 3) = 4294967295; the value 4294967295 must be rejected.
    const values = [4294967295, 4294967295, 7];
    const fill = (array: Uint32Array) => {
      array[0] = values.shift() ?? 0;
      return array;
    };
    expect(secureRandomIndex(3, fill)).toBe(7 % 3);
    expect(values).toHaveLength(0);
  });

  it("rejects an invalid bound", () => {
    const fill = (array: Uint32Array) => array;
    expect(() => secureRandomIndex(0, fill)).toThrow(RangeError);
    expect(() => secureRandomIndex(1.5, fill)).toThrow(RangeError);
  });
});
