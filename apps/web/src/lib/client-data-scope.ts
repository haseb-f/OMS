/**
 * SEC-02 — client-side data isolation between identities sharing one tab.
 *
 * Module-level caches (reference-data hooks, the picker lookup cache,
 * restorable list state, the navigation trail) live for the whole JS
 * session, and a client-side logout → login never reloads the page. Without
 * this module, data fetched under one identity (e.g. an admin's full user
 * list with emails) would be served to the next identity that logs in.
 *
 * Two independent safeguards:
 *
 *  1. Central reset registry — every per-identity cache registers a reset
 *     callback; `resetClientDataCaches()` runs them all. Called on logout,
 *     on login success, and whenever the identity fingerprint changes.
 *  2. Scoping — every cache entry is stored under the data scope it was
 *     fetched in (`<fingerprint>#<epoch>`; the epoch bumps on every reset).
 *     A read under a different scope is a miss, and a request that started
 *     under an earlier scope never writes into the current one — so even a
 *     missed reset can never serve one identity's data to another.
 *
 * The fingerprint is `${userId}:${companyId}:${permissionsHash}` — a change
 * of user, active company, or permission set is a new identity.
 */

type Listener = () => void;

export const ANONYMOUS_FINGERPRINT = "anonymous";

let fingerprint = ANONYMOUS_FINGERPRINT;
let epoch = 0;
let resetCount = 0;
const resetters = new Set<Listener>();
const scopeListeners = new Set<Listener>();
const inspectors = new Map<string, () => number>();

/** The scope new cache entries are stored under and reads must match. */
export function currentDataScope(): string {
  return `${fingerprint}#${epoch}`;
}

export function currentIdentityFingerprint(): string {
  return fingerprint;
}

/** For `useSyncExternalStore` — fires after every reset / identity change. */
export function subscribeDataScope(listener: Listener): () => void {
  scopeListeners.add(listener);
  return () => {
    scopeListeners.delete(listener);
  };
}

/** Registers a cache's reset callback. Returns an unregister function. */
export function registerClientCache(
  reset: Listener,
  inspect?: { name: string; size: () => number },
) {
  resetters.add(reset);
  if (inspect) inspectors.set(inspect.name, inspect.size);
  return () => {
    resetters.delete(reset);
    if (inspect) inspectors.delete(inspect.name);
  };
}

/** Drops every registered per-identity cache and invalidates in-flight requests. */
export function resetClientDataCaches(): void {
  epoch += 1;
  resetCount += 1;
  for (const reset of resetters) {
    try {
      reset();
    } catch {
      // One broken cache must never keep the others from resetting.
    }
  }
  scopeListeners.forEach((listener) => listener());
}

/** Sets the identity fingerprint; a change resets every cache. Returns whether it changed. */
export function setIdentityFingerprint(next: string): boolean {
  if (next === fingerprint) return false;
  fingerprint = next;
  resetClientDataCaches();
  return true;
}

/** FNV-1a (32-bit) — a short, stable digest; not a security primitive. */
function hashString(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function identityFingerprint(
  identity: {
    userId: string;
    companyId: string | null | undefined;
    permissions: readonly string[];
    isSuperAdmin?: boolean;
  } | null,
): string {
  if (!identity) return ANONYMOUS_FINGERPRINT;
  const permissions = [...new Set(identity.permissions)].sort().join(",");
  const digest = hashString(`${identity.isSuperAdmin ? "SA|" : ""}${permissions}`);
  return `${identity.userId}:${identity.companyId ?? "-"}:${digest}`;
}

// ---------------------------------------------------------------- storage

/** localStorage keys that hold one user's activity (not device preferences). */
const PER_USER_LOCAL_KEYS = [
  "oms.sidebar.authorizedItems",
  "oms.sidebar.recentPages",
  "oms.sales.recentCustomers",
  "oms.purchasing.recentSuppliers",
  "oms.partners.recentEmployees",
  "oms.partners.recentOwners",
];
const PER_USER_LOCAL_PREFIXES = ["oms.print-job.", "oms.partners.recent"];
/**
 * Device preferences — how THIS browser shows the app, not what a user did.
 * Deliberately kept across logout / user switch (listed so a new key is
 * classified on purpose, not by omission).
 */
export const DEVICE_PREFERENCE_LOCAL_KEYS = [
  "oms.locale",
  "oms.sidebar.expandedModule",
  "oms.sidebar.pinnedModules",
  "oms.report.summaryCollapsed",
] as const;
/** sessionStorage: the record trail (labels + unsaved editor drafts). */
const PER_USER_SESSION_KEYS = ["oms.navTrail", "oms.navRestore"];
/** The user id the per-user storage above currently belongs to. */
export const STORAGE_OWNER_KEY = "oms.session.storageOwner";
/**
 * SEC-03 M2 — the owner of THIS TAB's sessionStorage. localStorage is shared
 * by every tab, so its owner marker can already name the new user (claimed by
 * another tab) while this tab's sessionStorage still holds the previous
 * user's trail/drafts; the session marker lives with the data it guards.
 */
export const SESSION_STORAGE_OWNER_KEY = "oms.session.sessionOwner";

function clearPerUserSessionStorage(): void {
  try {
    for (const key of PER_USER_SESSION_KEYS) window.sessionStorage.removeItem(key);
    window.sessionStorage.removeItem(SESSION_STORAGE_OWNER_KEY);
  } catch {
    // Storage unavailable — nothing persisted to clear.
  }
}

/**
 * Removes browser storage that could reveal the previous user's activity
 * (recent partners, recent pages, last-authorized sidebar modules, pending
 * print payloads, the record trail with unsaved drafts). Device preferences
 * (locale, theme, table layout, pinned modules) are kept.
 */
export function clearPerUserBrowserStorage(): void {
  try {
    const local = window.localStorage;
    for (const key of PER_USER_LOCAL_KEYS) local.removeItem(key);
    for (let i = local.length - 1; i >= 0; i -= 1) {
      const key = local.key(i);
      if (key && PER_USER_LOCAL_PREFIXES.some((prefix) => key.startsWith(prefix))) {
        local.removeItem(key);
      }
    }
    local.removeItem(STORAGE_OWNER_KEY);
  } catch {
    // Storage unavailable — nothing persisted to clear.
  }
  clearPerUserSessionStorage();
}

/**
 * Claims per-user browser storage for `userId`: if it was written under a
 * different user (e.g. the previous session expired instead of logging
 * out), it is cleared first. Returns whether anything was cleared.
 */
export function claimPerUserBrowserStorage(userId: string): boolean {
  let cleared = false;
  let owner: string | null = null;
  let localAvailable = true;
  try {
    owner = window.localStorage.getItem(STORAGE_OWNER_KEY);
  } catch {
    localAvailable = false;
  }
  if (localAvailable && owner !== userId) {
    clearPerUserBrowserStorage();
    cleared = true;
  }
  // The tab's own sessionStorage is checked independently (M2): an absent
  // marker with trail data present is treated as foreign, too.
  let sessionOwner: string | null = null;
  let sessionAvailable = true;
  try {
    sessionOwner = window.sessionStorage.getItem(SESSION_STORAGE_OWNER_KEY);
  } catch {
    sessionAvailable = false;
  }
  if (sessionAvailable && sessionOwner !== userId) {
    const hadSessionData = PER_USER_SESSION_KEYS.some((key) => {
      try {
        return window.sessionStorage.getItem(key) !== null;
      } catch {
        return false;
      }
    });
    clearPerUserSessionStorage();
    cleared = cleared || hadSessionData;
  }
  try {
    if (localAvailable) window.localStorage.setItem(STORAGE_OWNER_KEY, userId);
    if (sessionAvailable) window.sessionStorage.setItem(SESSION_STORAGE_OWNER_KEY, userId);
  } catch {
    // Ignore.
  }
  return cleared;
}

// ---------------------------------------------------------------- scoped list cache

export interface ScopedListCache<T> {
  /** Starts a fetch for the current scope unless one is cached/in flight. */
  ensureLoaded(): void;
  /** Data for the CURRENT scope only — `null` when nothing is cached for it. */
  read(): T[] | null;
  /** True until the current scope's first response (a failure is "not loading"). */
  isLoading(): boolean;
  add(item: T): void;
  invalidate(): void;
  subscribe(listener: Listener): () => void;
}

/**
 * The one scoped, reset-registered session cache for a read-mostly list.
 * Every request remembers the scope it started in; a response arriving
 * after a reset (identity change) is discarded rather than cached.
 */
export function createScopedListCache<T>(
  name: string,
  fetcher: () => Promise<T[]>,
): ScopedListCache<T> {
  let cache: T[] | null = null;
  let cacheScope: string | null = null;
  let inFlight: Promise<T[]> | null = null;
  let inFlightScope: string | null = null;
  // Last request for `failedScope` failed (or was forbidden).
  let failedScope: string | null = null;
  const listeners = new Set<Listener>();
  const notify = () => listeners.forEach((listener) => listener());

  function read(): T[] | null {
    return cache !== null && cacheScope === currentDataScope() ? cache : null;
  }

  function ensureLoaded() {
    const scope = currentDataScope();
    if (read() || (inFlight && inFlightScope === scope)) return;
    const request = fetcher()
      .then((data) => {
        if (inFlight !== request || currentDataScope() !== scope) return data;
        cache = data;
        cacheScope = scope;
        inFlight = null;
        failedScope = null;
        notify();
        return data;
      })
      .catch(() => {
        if (inFlight !== request || currentDataScope() !== scope) return [];
        // Never cache a failure as a permanent empty list — the next
        // mount/invalidate retries.
        inFlight = null;
        failedScope = scope;
        notify();
        return [];
      });
    inFlight = request;
    inFlightScope = scope;
  }

  function reset() {
    cache = null;
    cacheScope = null;
    inFlight = null;
    inFlightScope = null;
    failedScope = null;
    notify();
  }

  registerClientCache(reset, { name, size: () => read()?.length ?? 0 });

  return {
    ensureLoaded,
    read,
    isLoading: () => read() === null && failedScope !== currentDataScope(),
    add(item: T) {
      const current = read();
      cache = current ? [...current, item] : [item];
      cacheScope = currentDataScope();
      notify();
    },
    invalidate() {
      cache = null;
      cacheScope = null;
      inFlight = null;
      inFlightScope = null;
      failedScope = null;
      ensureLoaded();
    },
    subscribe(listener: Listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

// ---------------------------------------------------------------- inspection

export interface ClientCacheStats {
  identity: string;
  epoch: number;
  resets: number;
  /** Per registered cache: entries held for the CURRENT scope. */
  caches: Record<string, number>;
}

export function clientCacheStats(): ClientCacheStats {
  const caches: Record<string, number> = {};
  for (const [name, size] of inspectors) caches[name] = size();
  return { identity: fingerprint, epoch, resets: resetCount, caches };
}

if (typeof window !== "undefined") {
  (window as unknown as { __omsClientCacheStats?: () => ClientCacheStats }).__omsClientCacheStats =
    clientCacheStats;
}
