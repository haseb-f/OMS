import { STORAGE_KEYS } from "../constants/storage-keys";
import { AGENT_PORTAL_HOME, routeAudienceMismatch } from "./route-access";

type UserType = "INTERNAL" | "AGENT" | undefined;

/** Pages a signed-in user must never be sent back to after login. */
const NON_DESTINATION_PREFIXES = ["/login", "/forgot-password", "/reset-password", "/investor"];

const PLACEHOLDER_ORIGIN = "http://oms.invalid";

function isUnder(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

/** The audience's authorized home: the agent portal for agents, the company dashboard otherwise. */
export function homePathFor(userType: UserType): string {
  return userType === "AGENT" ? AGENT_PORTAL_HOME : "/";
}

/**
 * R6 (spec A.4) — validates a `?next=` deep link: a same-origin RELATIVE path
 * (never `//host`, `\\host`, a scheme, or control characters), not an auth
 * page or the separate investor zone, and inside the user's own audience
 * (agents only `/agent*` + shared `/profile`; internal users never
 * `/agent*`). Returns the normalized path incl. query/hash, or null.
 * Page-level permissions are still enforced by `RouteAccessGuard`.
 */
export function safeNextPath(next: string | null | undefined, userType: UserType): string | null {
  if (!next || !next.startsWith("/") || next.startsWith("//")) return null;
  // Backslashes and control characters are normalized by browsers into
  // protocol-relative URLs or header tricks — refuse them outright.
  if (/[\\\u0000-\u001f\u007f]/.test(next)) return null;
  let url: URL;
  try {
    url = new URL(next, PLACEHOLDER_ORIGIN);
  } catch {
    return null;
  }
  if (url.origin !== PLACEHOLDER_ORIGIN) return null;
  const { pathname } = url;
  if (NON_DESTINATION_PREFIXES.some((prefix) => isUnder(pathname, prefix))) return null;
  if (routeAudienceMismatch(userType ?? "INTERNAL", pathname)) return null;
  return `${pathname}${url.search}${url.hash}`;
}

/** Where a successful login lands: a valid `next`, else the user's authorized dashboard directly (no bounce). */
export function resolvePostLoginPath(next: string | null | undefined, userType: UserType): string {
  return safeNextPath(next, userType) ?? homePathFor(userType);
}

/**
 * A fresh login starts with every sidebar group collapsed — the accordion's
 * remembered module from an earlier session is dropped; the active route's
 * parent still opens on arrival (AppSidebar), so the destination stays
 * discoverable.
 */
export function startFreshNavigationSession(storage?: Pick<Storage, "removeItem">): void {
  try {
    (storage ?? window.localStorage).removeItem(STORAGE_KEYS.sidebarExpandedSection);
  } catch {
    // Storage unavailable — nothing persisted to reset.
  }
}
