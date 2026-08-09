/**
 * The access token lives in a plain (non-httpOnly) cookie — not localStorage
 * — specifically so `middleware.ts` can read it on the server and redirect
 * unauthenticated requests before any page renders. Local development only:
 * a real deployment would use an httpOnly cookie set by the API response.
 */
const COOKIE_NAME = "oms_token";

export function setAuthToken(token: string, persistent: boolean) {
  const maxAge = persistent ? 60 * 60 * 24 * 30 : undefined; // 30 days, or session-only
  document.cookie = `${COOKIE_NAME}=${token}; path=/; SameSite=Lax${maxAge ? `; max-age=${maxAge}` : ""}`;
}

export function getAuthToken(): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(new RegExp(`(?:^|; )${COOKIE_NAME}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

export function clearAuthToken() {
  document.cookie = `${COOKIE_NAME}=; path=/; max-age=0`;
}
