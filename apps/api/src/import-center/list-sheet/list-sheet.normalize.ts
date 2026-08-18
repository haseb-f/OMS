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
    const value = raw.trim().replace(/\s+/g, ' ');
    if (!value) continue;
    const key = value.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(value);
  }
  unique.sort((a, b) =>
    a.localeCompare(b, ['ar', 'en'], { sensitivity: 'base', numeric: true }),
  );
  return unique;
}
