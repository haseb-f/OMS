/**
 * The access token lives in a plain (non-httpOnly) cookie — not localStorage
 * — specifically so `middleware.ts` can read it on the server and redirect
 * unauthenticated requests before any page renders. Local development only:
 * a real deployment would use an httpOnly cookie set by the API response.
 */
const COOKIE_NAME = "oms_token";

/** The cookie attributes of a stored token — R14: a session cookie only (no max-age / expires). */
export function authCookieValue(token: string): string {
  return `${COOKIE_NAME}=${token}; path=/; SameSite=Lax`;
}

/**
 * R14 (spec-1 §2) — always a SESSION cookie: "remember me" is gone, the
 * browser drops it on exit, and the server session (idle 2 h, absolute =
 * token lifetime) ends it regardless.
 */
export function setAuthToken(token: string) {
  document.cookie = authCookieValue(token);
}

export function getAuthToken(): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(new RegExp(`(?:^|; )${COOKIE_NAME}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

export function clearAuthToken() {
  document.cookie = `${COOKIE_NAME}=; path=/; max-age=0`;
}
