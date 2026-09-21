/**
 * Shared cache for picker lookups (product/partner search, recent items).
 * Every document line mounts its own picker; without this each open of
 * each row re-fetched the same first page. Identical concurrent requests
 * share one in-flight promise, results are reused for a short TTL, and a
 * failed request is never cached (the next open retries). Call
 * `invalidateLookups(prefix)` after creating a record so it shows up.
 */
const DEFAULT_TTL_MS = 60_000;

interface Entry {
  expiresAt: number;
  promise: Promise<unknown>;
}

const entries = new Map<string, Entry>();
let requestCount = 0;

export function cachedLookup<T>(
  key: string,
  fetcher: () => Promise<T>,
  ttlMs: number = DEFAULT_TTL_MS,
): Promise<T> {
  const now = Date.now();
  const hit = entries.get(key);
  if (hit && hit.expiresAt > now) return hit.promise as Promise<T>;
  requestCount += 1;
  const promise = fetcher().catch((error: unknown) => {
    entries.delete(key);
    throw error;
  });
  entries.set(key, { expiresAt: now + ttlMs, promise });
  return promise;
}

export function invalidateLookups(prefix: string): void {
  for (const key of entries.keys()) {
    if (key.startsWith(prefix)) entries.delete(key);
  }
}

/** Number of network lookups actually issued (cache misses) — exposed for performance checks. */
export function lookupRequestCount(): number {
  return requestCount;
}

if (typeof window !== "undefined") {
  (window as unknown as { __omsLookupStats?: () => number }).__omsLookupStats = lookupRequestCount;
}
