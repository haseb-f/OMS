import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ANONYMOUS_FINGERPRINT,
  claimPerUserBrowserStorage,
  clearPerUserBrowserStorage,
  clientCacheStats,
  createScopedListCache,
  currentDataScope,
  identityFingerprint,
  resetClientDataCaches,
  SESSION_STORAGE_OWNER_KEY,
  STORAGE_OWNER_KEY,
  setIdentityFingerprint,
} from "./client-data-scope";
import { cachedLookup, invalidateLookups, staleLookupEntryCount } from "./lookup-cache";

const A = identityFingerprint({
  userId: "admin",
  companyId: "c1",
  permissions: ["settings.manage"],
});
const B = identityFingerprint({
  userId: "agent",
  companyId: "c1",
  permissions: ["sales.orders.view"],
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  setIdentityFingerprint(ANONYMOUS_FINGERPRINT);
});

describe("identityFingerprint", () => {
  it("changes with user, company and permission set, and ignores permission order", () => {
    const base = { userId: "u1", companyId: "c1", permissions: ["a", "b"] };
    expect(identityFingerprint(base)).toBe(
      identityFingerprint({ ...base, permissions: ["b", "a"] }),
    );
    expect(identityFingerprint(base)).not.toBe(identityFingerprint({ ...base, userId: "u2" }));
    expect(identityFingerprint(base)).not.toBe(identityFingerprint({ ...base, companyId: "c2" }));
    expect(identityFingerprint(base)).not.toBe(
      identityFingerprint({ ...base, permissions: ["a"] }),
    );
    expect(identityFingerprint(base)).not.toBe(
      identityFingerprint({ ...base, isSuperAdmin: true }),
    );
    expect(identityFingerprint(null)).toBe(ANONYMOUS_FINGERPRINT);
  });
});

describe("scoped list cache", () => {
  it("serves identity A's rows only to A; switching to B is a miss and refetches", async () => {
    const fetcher = vi
      .fn<() => Promise<string[]>>()
      .mockResolvedValueOnce(["admin@x", "agent@x"])
      .mockResolvedValueOnce(["agent-visible"]);
    const cache = createScopedListCache("spec-users-1", fetcher);

    setIdentityFingerprint(A);
    cache.ensureLoaded();
    await vi.waitFor(() => expect(cache.read()).toEqual(["admin@x", "agent@x"]));
    cache.ensureLoaded(); // cached — no second request
    expect(fetcher).toHaveBeenCalledTimes(1);

    setIdentityFingerprint(B);
    expect(cache.read()).toBeNull();
    expect(cache.isLoading()).toBe(true);
    cache.ensureLoaded();
    expect(fetcher).toHaveBeenCalledTimes(2);
    await vi.waitFor(() => expect(cache.read()).toEqual(["agent-visible"]));
  });

  it("an in-flight request started under A never populates B's cache", async () => {
    const pendingA = deferred<string[]>();
    const fetcher = vi
      .fn<() => Promise<string[]>>()
      .mockReturnValueOnce(pendingA.promise)
      .mockResolvedValueOnce(["b-row"]);
    const cache = createScopedListCache("spec-users-2", fetcher);

    setIdentityFingerprint(A);
    cache.ensureLoaded();
    setIdentityFingerprint(B);
    pendingA.resolve(["a-secret"]);
    await flush();
    expect(cache.read()).toBeNull();

    cache.ensureLoaded();
    await vi.waitFor(() => expect(cache.read()).toEqual(["b-row"]));
    expect(cache.read()).not.toContain("a-secret");
  });

  it("an explicit reset under the same identity also drops in-flight results", async () => {
    const pending = deferred<string[]>();
    const fetcher = vi.fn<() => Promise<string[]>>().mockReturnValueOnce(pending.promise);
    const cache = createScopedListCache("spec-users-3", fetcher);
    setIdentityFingerprint(A);
    cache.ensureLoaded();
    const scopeBefore = currentDataScope();
    resetClientDataCaches();
    expect(currentDataScope()).not.toBe(scopeBefore);
    pending.resolve(["stale"]);
    await flush();
    expect(cache.read()).toBeNull();
  });

  it("reports per-cache sizes for the current scope only", async () => {
    const cache = createScopedListCache("spec-users-4", async () => ["x", "y"]);
    setIdentityFingerprint(A);
    cache.ensureLoaded();
    await vi.waitFor(() => expect(clientCacheStats().caches["spec-users-4"]).toBe(2));
    setIdentityFingerprint(B);
    expect(clientCacheStats().caches["spec-users-4"]).toBe(0);
  });
});

describe("lookup cache scoping", () => {
  it("does not return A's lookup to B and refetches", async () => {
    setIdentityFingerprint(A);
    const fetchA = vi.fn(async () => ["partner-of-admin"]);
    await expect(cachedLookup("partners:q", fetchA)).resolves.toEqual(["partner-of-admin"]);
    await cachedLookup("partners:q", fetchA);
    expect(fetchA).toHaveBeenCalledTimes(1);

    setIdentityFingerprint(B);
    expect(staleLookupEntryCount()).toBe(0);
    expect(clientCacheStats().caches.lookups).toBe(0);
    const fetchB = vi.fn(async () => ["partner-of-agent"]);
    await expect(cachedLookup("partners:q", fetchB)).resolves.toEqual(["partner-of-agent"]);
    expect(fetchB).toHaveBeenCalledTimes(1);
  });

  it("an A request still in flight at the switch is not served to B", async () => {
    setIdentityFingerprint(A);
    const pending = deferred<string[]>();
    const inFlightA = cachedLookup("products:q", () => pending.promise);
    setIdentityFingerprint(B);
    const fetchB = vi.fn(async () => ["b-product"]);
    const forB = cachedLookup("products:q", fetchB);
    pending.resolve(["a-product"]);
    await expect(inFlightA).resolves.toEqual(["a-product"]);
    await expect(forB).resolves.toEqual(["b-product"]);
    expect(fetchB).toHaveBeenCalledTimes(1);
    expect(staleLookupEntryCount()).toBe(0);
  });

  it("invalidateLookups only touches the current scope's prefix", async () => {
    setIdentityFingerprint(A);
    const fetcher = vi.fn(async () => 1);
    await cachedLookup("partners:x", fetcher);
    invalidateLookups("partners:");
    await cachedLookup("partners:x", fetcher);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});

describe("per-user browser storage", () => {
  it("clears activity keys but keeps device preferences", () => {
    localStorage.setItem("oms.sales.recentCustomers", '["p1"]');
    localStorage.setItem("oms.partners.recentOwners", '["p2"]');
    localStorage.setItem("oms.sidebar.authorizedItems", '["x"]');
    localStorage.setItem("oms.print-job.abc", "{}");
    localStorage.setItem("oms.orderDetail.u1.storeOrder.openSections", "{}");
    localStorage.setItem("oms.locale", '"ar"');
    sessionStorage.setItem("oms.navTrail", "[]");
    clearPerUserBrowserStorage();
    expect(localStorage.getItem("oms.sales.recentCustomers")).toBeNull();
    expect(localStorage.getItem("oms.partners.recentOwners")).toBeNull();
    expect(localStorage.getItem("oms.sidebar.authorizedItems")).toBeNull();
    expect(localStorage.getItem("oms.print-job.abc")).toBeNull();
    expect(localStorage.getItem("oms.orderDetail.u1.storeOrder.openSections")).toBeNull();
    expect(sessionStorage.getItem("oms.navTrail")).toBeNull();
    expect(localStorage.getItem("oms.locale")).toBe('"ar"');
  });

  it("claim clears storage written by a different user only", () => {
    claimPerUserBrowserStorage("admin");
    localStorage.setItem("oms.sales.recentCustomers", '["p1"]');
    expect(claimPerUserBrowserStorage("admin")).toBe(false);
    expect(localStorage.getItem("oms.sales.recentCustomers")).toBe('["p1"]');
    expect(claimPerUserBrowserStorage("agent")).toBe(true);
    expect(localStorage.getItem("oms.sales.recentCustomers")).toBeNull();
  });

  // SEC-03 M2 — localStorage is shared across tabs; this tab's sessionStorage is not.
  it("DENIED: a tab's sessionStorage trail from the previous user is cleared even when localStorage already names the new user", () => {
    claimPerUserBrowserStorage("admin");
    sessionStorage.setItem("oms.navTrail", '[{"label":"Invoice INV-1"}]');
    sessionStorage.setItem("oms.navRestore", '{"draft":"secret"}');
    // Another tab signs in as "agent" and claims the shared localStorage.
    localStorage.setItem(STORAGE_OWNER_KEY, "agent");
    // This tab now bootstraps as "agent": its own sessionStorage is still admin's.
    expect(claimPerUserBrowserStorage("agent")).toBe(true);
    expect(sessionStorage.getItem("oms.navTrail")).toBeNull();
    expect(sessionStorage.getItem("oms.navRestore")).toBeNull();
    expect(sessionStorage.getItem(SESSION_STORAGE_OWNER_KEY)).toBe("agent");
  });

  it("ALLOWED: the same user's trail survives a reload", () => {
    claimPerUserBrowserStorage("agent");
    sessionStorage.setItem("oms.navTrail", '[{"label":"Order SO-1"}]');
    expect(claimPerUserBrowserStorage("agent")).toBe(false);
    expect(sessionStorage.getItem("oms.navTrail")).toBe('[{"label":"Order SO-1"}]');
  });

  it("an unmarked trail (written before the marker existed) is treated as foreign", () => {
    localStorage.setItem(STORAGE_OWNER_KEY, "agent");
    sessionStorage.removeItem(SESSION_STORAGE_OWNER_KEY);
    sessionStorage.setItem("oms.navTrail", '[{"label":"x"}]');
    expect(claimPerUserBrowserStorage("agent")).toBe(true);
    expect(sessionStorage.getItem("oms.navTrail")).toBeNull();
  });
});
