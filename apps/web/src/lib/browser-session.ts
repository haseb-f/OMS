/**
 * R14 (spec-1 §2, D1-1) — "closing the browser signs you out", best effort.
 *
 * The auth cookie is a session cookie, but browsers that restore the previous
 * session ("continue where you left off") may keep session cookies alive. So
 * each tab carries its own `sessionStorage` marker, and a page load WITHOUT a
 * marker asks the other open tabs over a `BroadcastChannel` whether the
 * session is still in use:
 *
 *  - marker present            → this tab was reloaded / duplicated: keep.
 *  - another tab answers ≤400ms → a new tab opened beside a live one: keep.
 *  - nobody answers            → the cookie outlived the browser: the caller
 *                                signs out (server revoke) and goes to /login.
 *
 * Never relies on `unload` / `beforeunload`. Honest limitation (documented in
 * session-policy.md): a browser that restores per-tab `sessionStorage` too
 * makes a restart look like a reload — the server idle timeout and absolute
 * expiry still end the session.
 */

/** Per-tab marker; its value is a random tab id, never identity data. */
export const TAB_SESSION_MARKER_KEY = "oms.session.tab";
export const PRESENCE_CHANNEL_NAME = "oms.session.presence";
export const PRESENCE_TIMEOUT_MS = 400;

export type RestoredSessionVerdict = "this-tab" | "other-tab-alive" | "restored" | "unsupported";

type PresenceMessage = { type: "ping"; id: string } | { type: "pong"; id: string };

export interface PresenceChannel {
  postMessage(message: PresenceMessage): void;
  addEventListener(type: "message", listener: (event: MessageEvent<PresenceMessage>) => void): void;
  removeEventListener(
    type: "message",
    listener: (event: MessageEvent<PresenceMessage>) => void,
  ): void;
  close(): void;
}

export interface BrowserSessionDeps {
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem"> | null;
  openChannel: () => PresenceChannel | null;
  timeoutMs?: number;
}

function randomId(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function defaultDeps(): BrowserSessionDeps {
  let storage: Storage | null = null;
  try {
    storage = window.sessionStorage;
  } catch {
    storage = null;
  }
  return {
    storage,
    openChannel: () => {
      try {
        return typeof BroadcastChannel === "undefined"
          ? null
          : (new BroadcastChannel(PRESENCE_CHANNEL_NAME) as unknown as PresenceChannel);
      } catch {
        return null;
      }
    },
  };
}

/** Records that this tab holds the live session (after a login or an accepted load). */
export function markTabSession(deps: BrowserSessionDeps = defaultDeps()): void {
  try {
    if (!deps.storage?.getItem(TAB_SESSION_MARKER_KEY)) {
      deps.storage?.setItem(TAB_SESSION_MARKER_KEY, randomId());
    }
  } catch {
    // Storage unavailable — detection degrades to "unsupported".
  }
}

/** Drops this tab's marker (logout). */
export function clearTabSession(deps: BrowserSessionDeps = defaultDeps()): void {
  try {
    deps.storage?.removeItem(TAB_SESSION_MARKER_KEY);
  } catch {
    // Nothing to clear.
  }
}

/**
 * Decides whether a page load that HAS an auth cookie belongs to a live
 * browser session. Marks the tab when it does. "unsupported" (no
 * sessionStorage / BroadcastChannel) is treated as live by the caller.
 */
export async function detectRestoredSession(
  deps: BrowserSessionDeps = defaultDeps(),
): Promise<RestoredSessionVerdict> {
  let marked: string | null = null;
  try {
    marked = deps.storage?.getItem(TAB_SESSION_MARKER_KEY) ?? null;
  } catch {
    return "unsupported";
  }
  if (!deps.storage) return "unsupported";
  if (marked) return "this-tab";
  const channel = deps.openChannel();
  if (!channel) {
    markTabSession(deps);
    return "unsupported";
  }
  const id = randomId();
  const answered = await new Promise<boolean>((resolve) => {
    const onMessage = (event: MessageEvent<PresenceMessage>) => {
      if (event.data?.type === "pong" && event.data.id === id) finish(true);
    };
    const timer = setTimeout(() => finish(false), deps.timeoutMs ?? PRESENCE_TIMEOUT_MS);
    function finish(result: boolean) {
      clearTimeout(timer);
      channel?.removeEventListener("message", onMessage);
      channel?.close();
      resolve(result);
    }
    channel.addEventListener("message", onMessage);
    channel.postMessage({ type: "ping", id });
  });
  if (!answered) return "restored";
  markTabSession(deps);
  return "other-tab-alive";
}

/**
 * Answers other tabs' presence pings while this tab holds the live session
 * (marker present and `hasSession()` true). Returns an unsubscribe.
 */
export function answerPresencePings(
  hasSession: () => boolean,
  deps: BrowserSessionDeps = defaultDeps(),
): () => void {
  const channel = deps.openChannel();
  if (!channel) return () => undefined;
  const onMessage = (event: MessageEvent<PresenceMessage>) => {
    if (event.data?.type !== "ping") return;
    let marked = false;
    try {
      marked = Boolean(deps.storage?.getItem(TAB_SESSION_MARKER_KEY));
    } catch {
      marked = false;
    }
    if (marked && hasSession()) channel.postMessage({ type: "pong", id: event.data.id });
  };
  channel.addEventListener("message", onMessage);
  return () => {
    channel.removeEventListener("message", onMessage);
    channel.close();
  };
}
