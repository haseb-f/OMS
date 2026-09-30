/**
 * Test helper (spec-2-agent-pricing.md 2E): every key path of a response
 * that would expose carrier cost or the company shipping margin to an agent.
 */
export function leakedKeys(value: unknown, path = ''): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((v, i) => leakedKeys(v, `${path}[${i}]`));
  }
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([key, v]) => [
    ...(/cost|margin|carriercharge/i.test(key) || key === 'carrier'
      ? [`${path}.${key}`]
      : []),
    ...leakedKeys(v, `${path}.${key}`),
  ]);
}
