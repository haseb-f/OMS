import type { ImportFieldDef } from "@/services/import-types-service";

/** Header comparison key: trimmed, case-folded, without the template's required marker `*`. */
export function headerKey(value: string): string {
  return value
    .replace(/\*\s*$/, "")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("en-US");
}

/**
 * R15 — maps the file's headers to import fields by name: the field key, its
 * English template header, its Arabic template header (`labelAr`) or its label
 * in the current language. Only exact (normalised) matches; a header is used
 * once; unmatched fields stay unmapped for the user to choose.
 */
export function autoMapColumns(
  fields: ImportFieldDef[],
  headers: string[],
  localizedLabel: (field: ImportFieldDef) => string,
): Record<string, string> {
  const byKey = new Map<string, string>();
  for (const header of headers) {
    const key = headerKey(header);
    if (key && !byKey.has(key)) byKey.set(key, header);
  }
  const used = new Set<string>();
  const mapping: Record<string, string> = {};
  for (const field of fields) {
    const candidates = [field.key, field.label, field.labelAr, localizedLabel(field)]
      .filter((candidate): candidate is string => Boolean(candidate))
      .map(headerKey);
    const header = candidates.map((candidate) => byKey.get(candidate)).find(Boolean);
    if (header && !used.has(header)) {
      mapping[field.key] = header;
      used.add(header);
    }
  }
  return mapping;
}
