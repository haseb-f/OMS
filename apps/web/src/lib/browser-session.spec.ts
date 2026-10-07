import { describe, expect, it } from "vitest";
import {
  TAB_SESSION_MARKER_KEY,
  answerPresencePings,
  detectRestoredSession,
  markTabSession,
  type BrowserSessionDeps,
  type PresenceChannel,
} from "./browser-session";
import { authCookieValue } from "./auth-token";
import { LOGOUT_REDIRECT_PATH, resolvePostLoginPath } from "@/navigation/post-login";

/** In-memory BroadcastChannel bus: a message reaches every OTHER channel on the bus. */
function createBus() {
  const channels = new Set<FakeChannel>();
  class FakeChannel implements PresenceChannel {
    private listeners = new Set<(event: MessageEvent) => void>();
    constructor() {
      channels.add(this);
    }
    postMessage(message: unknown) {
      for (const other of channels) {
        if (other === this) continue;
        queueMicrotask(() => {
          for (const listener of other.listeners) listener({ data: message } as MessageEvent);
        });
      }
    }
    addEventListener(_type: "message", listener: (event: MessageEvent) => void) {
      this.listeners.add(listener);
    }
    removeEventListener(_type: "message", listener: (event: MessageEvent) => void) {
      this.listeners.delete(listener);
    }
    close() {
      channels.delete(this);
    }
  }
  return { open: () => new FakeChannel() };
}

function memoryStorage(): Pick<Storage, "getItem" | "setItem" | "removeItem"> {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
  };
}

function tab(bus: ReturnType<typeof createBus> | null): BrowserSessionDeps {
  return { storage: memoryStorage(), openChannel: () => bus?.open() ?? null, timeoutMs: 40 };
}

/** R14 spec-1 §2 — browser-restart detection (sessionStorage marker + BroadcastChannel handshake). */
describe("detectRestoredSession", () => {
  it("keeps a reloaded tab (its own marker survives a reload)", async () => {
    const deps = tab(createBus());
    markTabSession(deps);
    await expect(detectRestoredSession(deps)).resolves.toBe("this-tab");
  });

  it("accepts a new tab while another signed-in tab is alive, and marks it", async () => {
    const bus = createBus();
    const live = tab(bus);
    markTabSession(live);
    const stop = answerPresencePings(() => true, live);
    const fresh = tab(bus);
    await expect(detectRestoredSession(fresh)).resolves.toBe("other-tab-alive");
    expect(fresh.storage?.getItem(TAB_SESSION_MARKER_KEY)).toBeTruthy();
    stop();
  });

  it("treats a cookie with no marker and no live tab as a restored browser session", async () => {
    const fresh = tab(createBus());
    await expect(detectRestoredSession(fresh)).resolves.toBe("restored");
    expect(fresh.storage?.getItem(TAB_SESSION_MARKER_KEY)).toBeNull();
  });

  it("a tab without a marker (or signed out) never vouches for the session", async () => {
    const bus = createBus();
    const unmarked = tab(bus);
    const stopUnmarked = answerPresencePings(() => true, unmarked);
    const signedOut = tab(bus);
    markTabSession(signedOut);
    const stopSignedOut = answerPresencePings(() => false, signedOut);
    await expect(detectRestoredSession(tab(bus))).resolves.toBe("restored");
    stopUnmarked();
    stopSignedOut();
  });

  it("degrades to 'unsupported' (kept) without BroadcastChannel or sessionStorage", async () => {
    await expect(detectRestoredSession(tab(null))).resolves.toBe("unsupported");
    await expect(detectRestoredSession({ storage: null, openChannel: () => null })).resolves.toBe(
      "unsupported",
    );
  });
});

describe("session cookie and sign-out landing (spec-1 §1–2)", () => {
  it("stores the token as a session cookie only (no max-age / expires)", () => {
    const cookie = authCookieValue("abc");
    expect(cookie).toBe("oms_token=abc; path=/; SameSite=Lax");
    expect(cookie).not.toMatch(/max-age|expires/i);
  });

  it("logout lands on the bare login page, never with ?next=", () => {
    expect(LOGOUT_REDIRECT_PATH).toBe("/login");
    expect(LOGOUT_REDIRECT_PATH).not.toContain("next");
  });

  it("a fresh login lands on Home for each portal when no next is carried", () => {
    expect(resolvePostLoginPath(null, "INTERNAL")).toBe("/");
    expect(resolvePostLoginPath(null, "AGENT")).toBe("/agent");
    expect(resolvePostLoginPath("/login", "INTERNAL")).toBe("/");
  });
});
