import { BadRequestException } from '@nestjs/common';

interface SearchableService<T> {
  findAll(query: { search: string; pageSize: number }): Promise<{ items: T[] }>;
}

async function findIdByField<
  T extends { id: string } & Record<string, unknown>,
>(
  service: SearchableService<T>,
  field: keyof T & string,
  trimmed: string,
  label: string,
): Promise<string> {
  const result = await service.findAll({ search: trimmed, pageSize: 20 });
  const match = result.items.find(
    (item) => String(item[field] ?? '').toLowerCase() === trimmed.toLowerCase(),
  );
  if (!match) {
    throw new BadRequestException(`${label} "${trimmed}" not found.`);
  }
  return match.id;
}

/**
 * Resolves a human-readable CSV/Excel value (a name or code) to the id a
 * `Create*Dto` required foreign key needs — the same read-only lookup
 * `products-import.handler.ts` first established for `categoryName`/
 * `unitName`, generalized so every later handler (Warehouses, Chart of
 * Accounts, ...) reuses one implementation instead of its own copy.
 */
export async function resolveRequiredIdByField<
  T extends { id: string } & Record<string, unknown>,
>(
  service: SearchableService<T>,
  field: keyof T & string,
  value: string | undefined,
  label: string,
): Promise<string> {
  const trimmed = value?.trim();
  if (!trimmed) {
    throw new BadRequestException(`${label} is required.`);
  }
  return findIdByField(service, field, trimmed, label);
}

/** Same lookup as `resolveRequiredIdByField`, but an empty value resolves to `undefined` instead of throwing — for optional foreign keys. */
export async function resolveOptionalIdByField<
  T extends { id: string } & Record<string, unknown>,
>(
  service: SearchableService<T>,
  field: keyof T & string,
  value: string | undefined,
  label: string,
): Promise<string | undefined> {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  return findIdByField(service, field, trimmed, label);
}

/** Accepts common CSV/Excel truthy spellings ("true", "1", "yes", case-insensitive) for `boolean`-typed fields. */
export function parseBoolean(value: string | undefined): boolean | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  return /^(1|true|yes)$/i.test(trimmed);
}

/**
 * Groups rows sharing the same value for `groupKey` (a document-shaped
 * handler's `ImportTypeHandler.groupKey`) — preserving first-seen order, the
 * same order `run()`/`validate()` process rows in. A blank group-key value
 * never merges unrelated rows together: each gets its own singleton group,
 * so the existing "required field" check still reports a clean per-row
 * error instead of silently combining several unrelated blank rows into one
 * fake document.
 */
export function groupRowsByKey<T extends { mappedRow: Record<string, string> }>(
  rows: T[],
  groupKey: string,
): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  let blankIndex = 0;
  for (const row of rows) {
    const raw = row.mappedRow[groupKey]?.trim();
    const id = raw ? raw : `__blank_${blankIndex++}__`;
    const bucket = groups.get(id) ?? [];
    bucket.push(row);
    groups.set(id, bucket);
  }
  return groups;
}
