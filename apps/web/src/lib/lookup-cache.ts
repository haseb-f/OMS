import { currentDataScope, registerClientCache } from "./client-data-scope";

/**
 * Shared cache for picker lookups (product/partner search, recent items).
 * Every document line mounts its own picker; without this each open of
 * each row re-fetched the same first page. Identical concurrent requests
 * share one in-flight promise, results are reused for a short TTL, and a
 * failed request is never cached (the next open retries). Call
 * `invalidateLookups(prefix)` after creating a record so it shows up.
 *
 * SEC-02: entries are stored under the current identity's data scope
 * (`client-data-scope.ts`) and the whole cache is dropped on every reset —
 * a lookup fetched for one user/company/permission set is never returned
 * to another, and a request still in flight at the switch only ever lands
 * under its own (now unreachable) scope.
 */
const DEFAULT_TTL_MS = 60_000;

interface Entry {
  expiresAt: number;
  promise: Promise<unknown>;
}

const entries = new Map<string, Entry>();
let requestCount = 0;

const SCOPE_SEPARATOR = "␟";
const scoped = (key: string) => `${currentDataScope()}${SCOPE_SEPARATOR}${key}`;

registerClientCache(() => entries.clear(), {
  name: "lookups",
  size: () => {
    const prefix = scoped("");
    let count = 0;
    for (const key of entries.keys()) if (key.startsWith(prefix)) count += 1;
    return count;
  },
});

export function cachedLookup<T>(
  key: string,
  fetcher: () => Promise<T>,
  ttlMs: number = DEFAULT_TTL_MS,
): Promise<T> {
  const now = Date.now();
  const scopedKey = scoped(key);
  const hit = entries.get(scopedKey);
  if (hit && hit.expiresAt > now) return hit.promise as Promise<T>;
  requestCount += 1;
  const promise: Promise<T> = fetcher().catch((error: unknown) => {
    if (entries.get(scopedKey)?.promise === promise) entries.delete(scopedKey);
    throw error;
  });
  entries.set(scopedKey, { expiresAt: now + ttlMs, promise });
  return promise;
}

export function invalidateLookups(prefix: string): void {
  const scopedPrefix = scoped(prefix);
  for (const key of entries.keys()) {
    if (key.startsWith(scopedPrefix)) entries.delete(key);
  }
}

/** Entries held for scopes other than the current one — always 0 after a reset (exposed for isolation checks). */
export function staleLookupEntryCount(): number {
  const prefix = scoped("");
  let count = 0;
  for (const key of entries.keys()) if (!key.startsWith(prefix)) count += 1;
  return count;
}

/** Number of network lookups actually issued (cache misses) — exposed for performance checks. */
export function lookupRequestCount(): number {
  return requestCount;
}

if (typeof window !== "undefined") {
  const w = window as unknown as {
    __omsLookupStats?: (() => number) & { stale?: () => number };
  };
  w.__omsLookupStats = Object.assign(lookupRequestCount, { stale: staleLookupEntryCount });
}
