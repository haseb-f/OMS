/**
 * The one money formatter for OMS display. Grouping and two decimal places
 * are locale-independent (en-US numerals) so financial columns stay
 * scannable in Arabic UI without mixing digit systems.
 */
export function formatMoney(value: string | number, currencyCode?: string | null): string {
  const amount = Number(value);
  const formatted = Number.isFinite(amount)
    ? amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : "0.00";
  const code = currencyCode?.trim();
  return code ? `${formatted} ${code}` : formatted;
}

export function currencyCodeOf(currency: string | { code: string } | null | undefined): string {
  if (!currency) return "";
  return typeof currency === "string" ? currency : currency.code;
}
