/**
 * Investor Portal's own token storage — deliberately a SEPARATE cookie from
 * the internal admin session (`auth-token.ts`'s `oms_token`). Mission Part
 * 18/22/52: the Investor Portal is a fully separate external-access
 * boundary, end to end (backend guard, frontend token, this cookie) — an
 * internal admin session and a Portal session must never be confused or
 * collide in the same browser.
 */
const COOKIE_NAME = "oms_investor_token";

export function setInvestorPortalToken(token: string) {
  // 7 days — matches the backend's INVESTOR_PORTAL_JWT_TTL default.
  const maxAge = 60 * 60 * 24 * 7;
  document.cookie = `${COOKIE_NAME}=${token}; path=/; SameSite=Lax; max-age=${maxAge}`;
}

export function getInvestorPortalToken(): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(new RegExp(`(?:^|; )${COOKIE_NAME}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

export function clearInvestorPortalToken() {
  document.cookie = `${COOKIE_NAME}=; path=/; max-age=0`;
}
