import { AsyncLocalStorage } from 'async_hooks';

/**
 * Request-scoped cache for one Import Job's `validate()`/`run()` call —
 * every reference/Master-Data lookup a handler performs while processing
 * hundreds/thousands of rows shares ONE fetch per distinct cache key
 * instead of one query per row (the N+1 pattern this module exists to
 * eliminate). Scoped via `AsyncLocalStorage`, not a blind TTL: the cache is
 * exactly as long-lived as the `validate()`/`run()` call that created it,
 * so it can never serve stale Master Data across two different sync/import
 * runs, and a lookup performed outside any job (a unit test calling a
 * handler directly, for instance) transparently falls back to a live query
 * — see `import-value.util.ts`'s `fetchAllItems`.
 */
const store = new AsyncLocalStorage<Map<string, unknown>>();

export function runWithReferenceCache<T>(fn: () => Promise<T>): Promise<T> {
  return store.run(new Map(), fn);
}

/** Generic — holds a cached list (`unknown[]`, the original use) or any other per-job value (e.g. a `Map<externalOrderId, StoreOrder>` for batched lookups); callers cast to whatever they stored. */
export function getReferenceCache(): Map<string, unknown> | undefined {
  return store.getStore();
}
