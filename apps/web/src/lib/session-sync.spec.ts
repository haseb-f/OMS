import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  SESSION_PING_KEY,
  __resetSessionChannelForTests,
  announceSessionChange,
  createSessionIdentityGuard,
  resetAndReload,
  subscribeSessionSignals,
} from "./session-sync";
import {
  ANONYMOUS_FINGERPRINT,
  clientCacheStats,
  setIdentityFingerprint,
} from "./client-data-scope";

/** SEC-03 M1 — a tab never keeps rendering one identity under another identity's session. */
describe("createSessionIdentityGuard", () => {
  function setup(opts: { token: string | null; fetched?: string | null | Error }) {
    let token = opts.token;
    const onMismatch = vi.fn();
    const fetchUserId = vi.fn(async () => {
      if (opts.fetched instanceof Error) throw opts.fetched;
      return opts.fetched ?? null;
    });
    const guard = createSessionIdentityGuard({
      readToken: () => token,
      fetchUserId,
      onMismatch,
    });
    return {
      guard,
      onMismatch,
      fetchUserId,
      setToken: (next: string | null) => {
        token = next;
      },
    };
  }

  it("unchanged token: no request, no reset", async () => {
    const { guard, onMismatch, fetchUserId } = setup({ token: "t-admin" });
    guard.adopt("t-admin", "admin");
    await expect(guard.verify()).resolves.toBe(true);
    expect(fetchUserId).not.toHaveBeenCalled();
    expect(onMismatch).not.toHaveBeenCalled();
  });

  it("DENIED: another tab signed in as a different user → mismatch (reset + reload)", async () => {
    const { guard, onMismatch, setToken } = setup({ token: "t-admin", fetched: "agent" });
    guard.adopt("t-admin", "admin");
    setToken("t-agent");
    await expect(guard.verify()).resolves.toBe(false);
    expect(onMismatch).toHaveBeenCalledTimes(1);
    // Repeated signals never loop the reload.
    await guard.verify();
    expect(onMismatch).toHaveBeenCalledTimes(1);
  });

  it("DENIED: another tab logged out (cookie gone) → mismatch", async () => {
    const { guard, onMismatch, setToken, fetchUserId } = setup({ token: "t-admin" });
    guard.adopt("t-admin", "admin");
    setToken(null);
    await guard.verify();
    expect(fetchUserId).not.toHaveBeenCalled();
    expect(onMismatch).toHaveBeenCalledTimes(1);
  });

  it("DENIED: the new token is rejected (401 → null) → mismatch", async () => {
    const { guard, onMismatch, setToken } = setup({ token: "t-admin", fetched: null });
    guard.adopt("t-admin", "admin");
    setToken("t-expired");
    await guard.verify();
    expect(onMismatch).toHaveBeenCalledTimes(1);
  });

  it("ALLOWED: same user re-authenticated elsewhere → adopts the new token, no reset", async () => {
    const { guard, onMismatch, setToken, fetchUserId } = setup({ token: "t1", fetched: "admin" });
    guard.adopt("t1", "admin");
    setToken("t2");
    await expect(guard.verify()).resolves.toBe(true);
    await guard.verify();
    expect(fetchUserId).toHaveBeenCalledTimes(1);
    expect(onMismatch).not.toHaveBeenCalled();
  });

  it("network failure while checking keeps state (unknown ≠ changed)", async () => {
    const { guard, onMismatch, setToken } = setup({ token: "t1", fetched: new Error("offline") });
    guard.adopt("t1", "admin");
    setToken("t2");
    await expect(guard.verify()).resolves.toBe(true);
    expect(onMismatch).not.toHaveBeenCalled();
  });

  it("an anonymous tab (login page) is never reloaded by another tab's login", async () => {
    const { guard, onMismatch, setToken } = setup({ token: null, fetched: "agent" });
    guard.adopt(null, null);
    setToken("t-agent");
    await guard.verify();
    expect(onMismatch).not.toHaveBeenCalled();
  });
});

describe("resetAndReload", () => {
  it("drops every client cache before reloading", () => {
    setIdentityFingerprint(ANONYMOUS_FINGERPRINT);
    const reload = vi.fn();
    const original = window.location;
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...original, reload },
    });
    try {
      const before = clientCacheStats().resets;
      resetAndReload();
      expect(clientCacheStats().resets).toBe(before + 1);
      expect(reload).toHaveBeenCalledTimes(1);
    } finally {
      Object.defineProperty(window, "location", { configurable: true, value: original });
    }
  });
});

describe("cross-tab signals", () => {
  beforeEach(() => __resetSessionChannelForTests());
  afterEach(() => __resetSessionChannelForTests());

  it("fires on window focus and when the tab becomes visible", () => {
    const signal = vi.fn();
    const unsubscribe = subscribeSessionSignals(signal);
    window.dispatchEvent(new Event("focus"));
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    document.dispatchEvent(new Event("visibilitychange"));
    expect(signal).toHaveBeenCalledTimes(2);
    unsubscribe();
    window.dispatchEvent(new Event("focus"));
    expect(signal).toHaveBeenCalledTimes(2);
  });

  it("fires on another tab's localStorage ping (BroadcastChannel fallback)", () => {
    const signal = vi.fn();
    const unsubscribe = subscribeSessionSignals(signal);
    window.dispatchEvent(new StorageEvent("storage", { key: "unrelated" }));
    window.dispatchEvent(new StorageEvent("storage", { key: SESSION_PING_KEY }));
    expect(signal).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it("falls back to the storage ping when BroadcastChannel is unavailable", () => {
    const original = globalThis.BroadcastChannel;
    // @ts-expect-error — simulate a browser without BroadcastChannel.
    delete globalThis.BroadcastChannel;
    try {
      localStorage.removeItem(SESSION_PING_KEY);
      announceSessionChange();
      expect(localStorage.getItem(SESSION_PING_KEY)).not.toBeNull();
    } finally {
      globalThis.BroadcastChannel = original;
    }
  });

  it("announces over BroadcastChannel to other tabs when available", async () => {
    if (typeof BroadcastChannel === "undefined") return;
    const other = new BroadcastChannel("oms.session");
    const received = new Promise<unknown>((resolve) => {
      other.onmessage = (event) => resolve(event.data);
    });
    announceSessionChange();
    await expect(received).resolves.toEqual({ type: "session-changed" });
    other.close();
  });
});
