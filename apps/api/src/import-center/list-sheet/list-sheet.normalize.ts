/**
 * One human-readable master-data value: trim, collapse repeated whitespace,
 * preserve Arabic. Never transliterates and never replaces a display value
 * with an ID/SKU/UUID.
 */
export function normalizeReferenceValue(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ');
}

/** Comparison key for display-value matching — case-insensitive, Arabic-safe. */
export function referenceValueKey(raw: string): string {
  return normalizeReferenceValue(raw).toLocaleLowerCase('ar');
}

/**
 * Human-readable List Sheet values: trim, collapse whitespace, drop empties,
 * case-insensitive dedupe (first spelling wins), locale-aware sort.
 * Never transliterates Arabic and never replaces a display value with an ID.
 */
export function normalizeListValues(
  values: Array<string | null | undefined>,
): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const raw of values) {
    if (raw == null) continue;
    const value = normalizeReferenceValue(raw);
    if (!value) continue;
    const key = referenceValueKey(value);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(value);
  }
  unique.sort((a, b) =>
    a.localeCompare(b, ['ar', 'en'], { sensitivity: 'base', numeric: true }),
  );
  return unique;
}
