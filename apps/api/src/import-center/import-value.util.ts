import { BadRequestException, HttpException } from '@nestjs/common';
import { getReferenceCache } from './reference-data/reference-cache';

export function extractImportErrorMessage(error: unknown): string {
  if (error instanceof HttpException) {
    const res = error.getResponse();
    if (typeof res === 'string') return res;
    if (typeof res === 'object' && res !== null) {
      const body = res as { message?: unknown };
      if (typeof body.message === 'string') return body.message;
      if (Array.isArray(body.message)) {
        return body.message
          .filter((item) => typeof item === 'string')
          .join('; ');
      }
    }
    return error.message;
  }
  if (error instanceof Error) return error.message;
  return 'Validation failed.';
}

export function extractExistingRecordId(message: string): string | null {
  const match = message.match(/already exists \(([^)]+)\)/i);
  return match?.[1]?.trim() || null;
}

interface SearchableService<T> {
  findAll(query: {
    search: string;
    pageSize: number;
    page?: number;
  }): Promise<{ items: T[]; total?: number }>;
}

/**
 * The full row set for one `(service, field)` pair — paged through at a
 * safe, universally-accepted page size (every list endpoint's `pageSize`
 * DTO caps somewhere between 200 and 1000; 200 is the lowest of those, see
 * `find-products-query.dto.ts`) rather than one best-guess huge `pageSize`,
 * so this works unmodified against any current or future service. Cached
 * per import run (see `reference-cache.ts`) — a search-matched lookup used
 * to only ever see the first 20 results (`findAll({search, pageSize:20})`),
 * silently mis-reporting "not found" for a real value ranked 21st+; fetching
 * everything once and matching in memory fixes that correctness bug too.
 */
async function fetchAllItems<
  T extends { id: string } & Record<string, unknown>,
>(service: SearchableService<T>, cacheKey: string): Promise<T[]> {
  const cache = getReferenceCache();
  const cached = cache?.get(cacheKey);
  if (cached) return cached as T[];

  const pageSize = 200;
  let page = 1;
  let items: T[] = [];
  for (;;) {
    const result = await service.findAll({ search: '', pageSize, page });
    items = items.concat(result.items);
    const total = result.total ?? items.length;
    if (items.length >= total || result.items.length < pageSize) break;
    page++;
  }
  cache?.set(cacheKey, items);
  return items;
}

async function findRecordByField<
  T extends { id: string } & Record<string, unknown>,
>(
  service: SearchableService<T>,
  field: keyof T & string,
  trimmed: string,
  label: string,
): Promise<T> {
  const cacheKey = `${service.constructor.name}:${field}`;
  const items = await fetchAllItems(service, cacheKey);
  const match = items.find(
    (item) => String(item[field] ?? '').toLowerCase() === trimmed.toLowerCase(),
  );
  if (!match) {
    throw new BadRequestException(`${label} "${trimmed}" not found.`);
  }
  return match;
}

/** Same lookup as `resolveRequiredIdByField`, but returns the whole matched record — for a caller that needs more than the id (e.g. `resolveProductBySku` also needs `unitId`). */
export async function resolveRequiredRecordByField<
  T extends { id: string } & Record<string, unknown>,
>(
  service: SearchableService<T>,
  field: keyof T & string,
  value: string | undefined,
  label: string,
): Promise<T> {
  const trimmed = value?.trim();
  if (!trimmed) {
    throw new BadRequestException(`${label} is required.`);
  }
  return findRecordByField(service, field, trimmed, label);
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
  const record = await resolveRequiredRecordByField(
    service,
    field,
    value,
    label,
  );
  return record.id;
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
  const record = await findRecordByField(service, field, trimmed, label);
  return record.id;
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
    // Case-fold so External Order ID variants in one sheet stay one group.
    const id = raw
      ? raw.toLocaleLowerCase('en-US')
      : `__blank_${blankIndex++}__`;
    const bucket = groups.get(id) ?? [];
    bucket.push(row);
    groups.set(id, bucket);
  }
  return groups;
}
