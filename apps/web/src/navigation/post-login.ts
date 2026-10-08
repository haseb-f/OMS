import { STORAGE_KEYS } from "../constants/storage-keys";
import type { AudienceUserType } from "../types/navigation";
import {
  AGENT_PORTAL_HOME,
  PARTNER_PORTAL_HOME,
  isUnderRoute,
  routeAudienceMismatch,
} from "./route-access";

type UserType = AudienceUserType | undefined;

/** Pages a signed-in user must never be sent back to after login. */
const NON_DESTINATION_PREFIXES = ["/login", "/forgot-password", "/reset-password", "/investor"];

const PLACEHOLDER_ORIGIN = "http://oms.invalid";

/** The audience's authorized home: the agent portal, the partner portal, else the company Home. */
export function homePathFor(userType: UserType): string {
  if (userType === "AGENT") return AGENT_PORTAL_HOME;
  if (userType === "PARTNER") return PARTNER_PORTAL_HOME;
  return "/";
}

/**
 * R6 (spec A.4) — validates a `?next=` deep link: a same-origin RELATIVE path
 * (never `//host`, `\\host`, a scheme, or control characters), not an auth
 * page or the separate investor zone, and inside the user's own audience
 * (agents only `/agent*`, partners only `/partner*`, both + shared
 * `/profile`; internal users never either portal). Returns the normalized path incl. query/hash, or null.
 * Page-level permissions are still enforced by `RouteAccessGuard`.
 */
export function safeNextPath(next: string | null | undefined, userType: UserType): string | null {
  if (!next || !next.startsWith("/") || next.startsWith("//")) return null;
  // Backslashes and control characters (incl. tab/newline, which URL parsing
  // silently strips) are normalized by browsers into protocol-relative URLs
  // or header tricks — refuse them outright.
  if (/[\\\u0000-\u001f\u007f]/.test(next)) return null;
  // Dot segments (`.`, `..`, `%2e`, `%2E%2e`, …) are resolved by URL parsing
  // and can collapse `/.//evil.com` into `//evil.com` — never accept them.
  const rawPath = next.split(/[?#]/, 1)[0];
  if (rawPath.split("/").some((segment) => /^(?:\.|%2e){1,2}$/i.test(segment))) return null;
  let url: URL;
  try {
    url = new URL(next, PLACEHOLDER_ORIGIN);
  } catch {
    return null;
  }
  if (url.origin !== PLACEHOLDER_ORIGIN) return null;
  const { pathname } = url;
  // Re-validate the NORMALIZED path: exactly one leading slash.
  if (!pathname.startsWith("/") || pathname.startsWith("//") || pathname.startsWith("/\\")) {
    return null;
  }
  if (NON_DESTINATION_PREFIXES.some((prefix) => isUnderRoute(pathname, prefix))) return null;
  if (routeAudienceMismatch(userType ?? "INTERNAL", pathname)) return null;
  return `${pathname}${url.search}${url.hash}`;
}

/**
 * R14 (spec-1 §1, D1-2) — where a deliberate sign-out (and a sign-out forced
 * by a restored-browser session) goes: the bare login page, never with
 * `?next=`. Only the proxy's signed-out deep-link redirect and the in-app
 * session-expiry redirect (`api-client` 401) carry `next`.
 */
export const LOGOUT_REDIRECT_PATH = "/login";

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
