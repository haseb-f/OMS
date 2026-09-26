import { resetClientDataCaches } from "./client-data-scope";

/**
 * SEC-03 M1 — cross-tab session isolation.
 *
 * The access token is a cookie shared by every tab, but each tab's React
 * state and module caches were bootstrapped for ONE identity. When another
 * tab logs out or signs in as someone else, this tab would keep rendering
 * (and caching) the previous identity's data while its requests silently
 * carry the new token. So every tab:
 *
 *  - announces its own login/logout/identity change (`announceSessionChange`)
 *    over a BroadcastChannel, falling back to a localStorage `storage` ping;
 *  - on such an announcement, on window focus and whenever it becomes
 *    visible, re-checks that the cookie token still belongs to the identity
 *    it bootstrapped with (`SessionIdentityGuard.verify`);
 *  - on a mismatch, drops every client cache and hard-reloads, so no mounted
 *    state from the previous identity survives (the reload re-bootstraps —
 *    or lands on /login via proxy.ts when there is no session any more).
 */

const CHANNEL_NAME = "oms.session";
/** localStorage fallback key — its value is only a changing nonce, never identity data. */
export const SESSION_PING_KEY = "oms.session.ping";

export interface SessionIdentityDeps {
  /** The current shared auth token (cookie), or null when signed out. */
  readToken: () => string | null;
  /** The user id the CURRENT token belongs to (e.g. `GET /auth/me`); null when it is rejected. */
  fetchUserId: () => Promise<string | null>;
  /** Called once per detected identity change. */
  onMismatch: () => void;
}

export interface SessionIdentityGuard {
  /** Records the identity this tab is rendering for (after a successful bootstrap/login). */
  adopt(token: string | null, userId: string | null): void;
  /** Re-checks the shared token against the adopted identity; resolves true when it still matches. */
  verify(): Promise<boolean>;
}

export function createSessionIdentityGuard(deps: SessionIdentityDeps): SessionIdentityGuard {
  let known: { token: string | null; userId: string | null } | null = null;
  let pending: Promise<boolean> | null = null;
  let tripped = false;

  const mismatch = () => {
    if (tripped) return false;
    tripped = true;
    deps.onMismatch();
    return false;
  };

  async function check(): Promise<boolean> {
    if (!known || tripped) return !tripped;
    const token = deps.readToken();
    if (token === known.token) return true;
    // A signed-in tab whose session vanished (logout elsewhere / expiry).
    if (!token) return known.userId ? mismatch() : true;
    // An anonymous tab (login page) has no identity-bound state to protect.
    if (!known.userId) return true;
    let userId: string | null = null;
    try {
      userId = await deps.fetchUserId();
    } catch {
      // Unknown (network) — keep the current state; the next focus/ping retries.
      return true;
    }
    if (userId !== known.userId) return mismatch();
    // Same user re-authenticated in another tab: adopt the fresh token.
    known = { token, userId };
    return true;
  }

  return {
    adopt(token, userId) {
      known = { token, userId };
      tripped = false;
    },
    verify() {
      pending ??= check().finally(() => {
        pending = null;
      });
      return pending;
    },
  };
}

/** Default mismatch handling: nothing from the previous identity may survive. */
export function resetAndReload(): void {
  resetClientDataCaches();
  window.location.reload();
}

let channel: BroadcastChannel | null | undefined;
function getChannel(): BroadcastChannel | null {
  if (channel !== undefined) return channel;
  try {
    channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(CHANNEL_NAME);
  } catch {
    channel = null;
  }
  return channel;
}

/** Tells every other tab that this tab's session identity changed (login, logout, user switch). */
export function announceSessionChange(): void {
  const bc = getChannel();
  if (bc) {
    try {
      bc.postMessage({ type: "session-changed" });
      return;
    } catch {
      // Fall through to the storage ping.
    }
  }
  try {
    window.localStorage.setItem(SESSION_PING_KEY, `${Date.now()}:${Math.random()}`);
  } catch {
    // No cross-tab transport — focus/visibility checks still cover it.
  }
}

/**
 * Runs `onSignal` whenever another tab announces a session change, and on
 * window focus / when the tab becomes visible. Returns an unsubscribe.
 */
export function subscribeSessionSignals(onSignal: () => void): () => void {
  const bc = getChannel();
  const onMessage = () => onSignal();
  const onStorage = (event: StorageEvent) => {
    if (event.key === SESSION_PING_KEY) onSignal();
  };
  const onVisibility = () => {
    if (document.visibilityState === "visible") onSignal();
  };
  bc?.addEventListener("message", onMessage);
  window.addEventListener("storage", onStorage);
  window.addEventListener("focus", onSignal);
  document.addEventListener("visibilitychange", onVisibility);
  return () => {
    bc?.removeEventListener("message", onMessage);
    window.removeEventListener("storage", onStorage);
    window.removeEventListener("focus", onSignal);
    document.removeEventListener("visibilitychange", onVisibility);
  };
}

/** Test-only: forget the lazily created channel. */
export function __resetSessionChannelForTests(): void {
  channel?.close();
  channel = undefined;
}
