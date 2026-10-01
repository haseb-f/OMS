/** Name in the UI language when the record carries an English name (Arabic `name` is the primary identity). */
export function localizedName(
  record: { name: string; nameEn?: string | null; displayName?: string | null } | null | undefined,
  locale: "ar" | "en",
): string {
  if (!record) return "";
  if (locale === "en" && record.nameEn) return record.nameEn;
  return record.displayName || record.name;
}
