/**
 * Contextual navigation trail — "where did I come from" for record-to-record
 * navigation (invoice → JE → receipt …). Each "Open Full Record" pushes the
 * originating route (path + query, scroll position, optional unsaved editor
 * snapshot) so the destination can offer an explicit return that restores
 * it. Session-scoped (sessionStorage), so a reload keeps the trail but a new
 * tab starts clean. The browser Back button stays authoritative: landing on
 * an entry's origin by any means pops it (see `syncTrailWithPath`).
 */

export interface NavigationOrigin {
  /** Origin route including query string (filters, tabs). */
  href: string;
  /** Human reference of the origin, e.g. "Sales Invoice INV-2026-000012". */
  label: string;
  scrollY: number;
  /** Unsaved editor state captured at departure (see useNavigationDraft). */
  draft?: unknown;
  /** Destination route (path + query) this entry leads to. */
  target: string;
  targetLabel: string;
}

const STACK_KEY = "oms.navTrail";
const RESTORE_KEY = "oms.navRestore";
const MAX_DEPTH = 8;
const listeners = new Set<() => void>();
const draftProviders = new Map<string, () => unknown>();

function pathOf(href: string): string {
  return href.split("#")[0].split("?")[0];
}

function read<T>(key: string, fallback: T): T {
  try {
    const raw = window.sessionStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): void {
  try {
    if (value === null) window.sessionStorage.removeItem(key);
    else window.sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage unavailable (private mode / quota) — the trail degrades to none.
  }
}

let cachedStack: NavigationOrigin[] | null = null;

export function getTrail(): NavigationOrigin[] {
  if (typeof window === "undefined") return EMPTY;
  if (cachedStack === null) cachedStack = read<NavigationOrigin[]>(STACK_KEY, []);
  return cachedStack;
}
const EMPTY: NavigationOrigin[] = [];

function setTrail(next: NavigationOrigin[]): void {
  cachedStack = next;
  write(STACK_KEY, next.length > 0 ? next : null);
  listeners.forEach((listener) => listener());
}

export function subscribeTrail(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Editors register a snapshot of their unsaved state for the current path. */
export function registerDraftProvider(path: string, provider: () => unknown): () => void {
  draftProviders.set(path, provider);
  return () => {
    if (draftProviders.get(path) === provider) draftProviders.delete(path);
  };
}

/** Records the current location as the origin of a navigation to `target`. */
export function pushOrigin(input: { label: string; target: string; targetLabel: string }): void {
  const path = window.location.pathname;
  const origin: NavigationOrigin = {
    href: `${path}${window.location.search}`,
    label: input.label,
    scrollY: window.scrollY,
    draft: draftProviders.get(path)?.(),
    target: input.target,
    targetLabel: input.targetLabel,
  };
  const stack = getTrail();
  // Continue the chain only when leaving the current trail head; otherwise
  // this is a fresh journey.
  const head = stack.at(-1);
  const base = head && pathOf(head.target) === path ? stack : [];
  setTrail([...base, origin].slice(-MAX_DEPTH));
}

/** Pops back to `index` (inclusive) and returns the origin to navigate to. */
export function takeOrigin(index: number): NavigationOrigin | null {
  const stack = getTrail();
  const origin = stack[index];
  if (!origin) return null;
  setTrail(stack.slice(0, index));
  scheduleRestore(origin);
  return origin;
}

/**
 * Keeps the trail consistent with the real history on every route change:
 * arriving at an entry's origin (browser Back, or our return control) pops
 * it and schedules its restore; arriving at an entry's target truncates
 * anything above it; any unrelated route ends the journey.
 */
export function syncTrailWithPath(path: string): void {
  const stack = getTrail();
  if (stack.length === 0) return;
  for (let index = stack.length - 1; index >= 0; index -= 1) {
    if (pathOf(stack[index].target) === path) {
      if (index < stack.length - 1) setTrail(stack.slice(0, index + 1));
      return;
    }
    if (pathOf(stack[index].href) === path) {
      if (!pendingRestoreFor(path)) scheduleRestore(stack[index]);
      setTrail(stack.slice(0, index));
      return;
    }
  }
  setTrail([]);
}

/** A restore is only honoured shortly after the return navigation. */
const RESTORE_TTL_MS = 30_000;

function scheduleRestore(origin: NavigationOrigin): void {
  write(RESTORE_KEY, { ...origin, at: Date.now() });
}

export function pendingRestoreFor(path: string): NavigationOrigin | null {
  if (typeof window === "undefined") return null;
  const pending = read<(NavigationOrigin & { at?: number }) | null>(RESTORE_KEY, null);
  if (!pending || Date.now() - (pending.at ?? 0) > RESTORE_TTL_MS) return null;
  return pathOf(pending.href) === path ? pending : null;
}

/** Consumes the pending draft for `path` (once). */
export function consumeDraft(path: string): unknown {
  const pending = pendingRestoreFor(path);
  if (!pending || pending.draft === undefined) return undefined;
  write(RESTORE_KEY, { ...pending, draft: undefined });
  return pending.draft;
}

/** Consumes the pending scroll restore for `path` (once). */
export function consumeScroll(path: string): number | null {
  const pending = pendingRestoreFor(path);
  if (!pending) return null;
  if (pending.draft === undefined) write(RESTORE_KEY, null);
  else write(RESTORE_KEY, { ...pending, scrollY: -1 });
  return pending.scrollY >= 0 ? pending.scrollY : null;
}
