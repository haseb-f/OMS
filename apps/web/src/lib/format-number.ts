/**
 * Plain (non-money) number formatting — counts, quantities, unit costs shown
 * without a fixed precision. Always a fixed `en-US` format, never the
 * browser/OS locale, so digits stay Latin in both UI languages
 * (design-system §2). Amounts with fixed decimals use `formatAmount` /
 * `formatMoney` from `@/lib/money` instead.
 */

const formatters = new Map<string, Intl.NumberFormat>();

function formatterFor(minDecimals: number, maxDecimals: number): Intl.NumberFormat {
  const key = `${minDecimals}:${maxDecimals}`;
  let formatter = formatters.get(key);
  if (!formatter) {
    formatter = new Intl.NumberFormat("en-US", {
      minimumFractionDigits: minDecimals,
      maximumFractionDigits: maxDecimals,
    });
    formatters.set(key, formatter);
  }
  return formatter;
}

/**
 * `1234.5` → `"1,234.5"`. Defaults match `Number#toLocaleString()` (0–3
 * fraction digits); a non-finite input formats as `0`.
 */
export function formatNumber(
  value: number | string | null | undefined,
  {
    minDecimals = 0,
    maxDecimals = Math.max(minDecimals, 3),
  }: { minDecimals?: number; maxDecimals?: number } = {},
): string {
  const number = typeof value === "number" ? value : Number(value);
  return formatterFor(minDecimals, maxDecimals).format(Number.isFinite(number) ? number : 0);
}
