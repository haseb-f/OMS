import { NextResponse, type NextRequest } from "next/server";
import {
  AGENT_PORTAL_HOME,
  PARTNER_PORTAL_HOME,
  isUnderRoute,
  routeAudienceMismatch,
} from "./navigation/route-access";

const PUBLIC_PATHS = ["/login", "/forgot-password", "/reset-password"];

/**
 * Investor Portal (mission Part 18/22/25/52) is a fully separate
 * external-access zone: its own cookie (`oms_investor_token`, never the
 * internal `oms_token`), its own public paths, its own login redirect
 * target. Deliberately checked BEFORE the internal logic below so an
 * `/investor/*` request never falls through to the internal `/login`
 * redirect.
 */
const INVESTOR_PORTAL_PUBLIC_PATHS = [
  "/investor/login",
  "/investor/forgot-password",
  "/investor/activate",
];

function investorPortalProxy(request: NextRequest, pathname: string) {
  const hasToken = Boolean(request.cookies.get("oms_investor_token")?.value);
  const isPublicPath = INVESTOR_PORTAL_PUBLIC_PATHS.some((path) => pathname.startsWith(path));

  if (!hasToken && !isPublicPath) {
    const loginUrl = new URL("/investor/login", request.url);
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  if (hasToken && isPublicPath) {
    return NextResponse.redirect(new URL("/investor/dashboard", request.url));
  }

  return NextResponse.next();
}

/**
 * The audience claim of an access token (`typ`: "agent" / "partner"), read
 * WITHOUT verifying the signature. Routing only — the claim is NOT trusted for
 * authorization (the API verifies the signature on every call and the
 * shell's route guard enforces the audience); a malformed token reads as
 * internal.
 */
function tokenAudience(token: string | undefined): "agent" | "partner" | "internal" {
  try {
    const payload = token?.split(".")[1];
    if (!payload) return "internal";
    const json = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
    const typ = (JSON.parse(json) as { typ?: string }).typ;
    return typ === "agent" || typ === "partner" ? typ : "internal";
  } catch {
    return "internal";
  }
}

/** Where an already signed-in visitor of a public auth page goes: the audience's own home. */
function homeForToken(token: string | undefined): string {
  const audience = tokenAudience(token);
  if (audience === "agent") return AGENT_PORTAL_HOME;
  if (audience === "partner") return PARTNER_PORTAL_HOME;
  return "/";
}

/**
 * R15 (D15-14) — a company partner's login lives in its own zone: any other
 * page (the company Home, a module, a deep link) is answered with a redirect
 * to the partner portal before the shell renders, except the shared own
 * profile / password pages and the isolated print preview of its statement.
 * The API refuses a partner token everywhere else regardless.
 */
const PARTNER_PASSTHROUGH = ["/print"];

function partnerOutsideZone(pathname: string): boolean {
  return (
    routeAudienceMismatch("PARTNER", pathname) === "partner-outside-portal" &&
    !PARTNER_PASSTHROUGH.some((prefix) => isUnderRoute(pathname, prefix))
  );
}

/**
 * Route protection (ADR-0022, Part 7): unauthenticated users are always
 * redirected to /login. This only checks whether an access-token cookie is
 * present — real verification happens on every API call via the backend's
 * JwtAuthGuard; this proxy exists purely to stop the shell from flashing
 * protected UI before that check can happen. (Next.js renamed the
 * `middleware` file convention to `proxy` in v16 — see proxy.ts docs.)
 */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Anchored to a path boundary — `/investors/...` (the plural, ADMIN
  // "Investors" module under (shell)) must never be captured by the
  // singular Investor Portal zone just because the string starts the same.
  if (pathname === "/investor" || pathname.startsWith("/investor/")) {
    return investorPortalProxy(request, pathname);
  }

  const token = request.cookies.get("oms_token")?.value;
  const hasToken = Boolean(token);
  const isPublicPath = PUBLIC_PATHS.some((path) => pathname.startsWith(path));

  if (!hasToken && !isPublicPath) {
    const loginUrl = new URL("/login", request.url);
    // R6 (spec A.4) — keep the whole deep link, query string included; the
    // login page validates it before navigating (`navigation/post-login.ts`).
    loginUrl.searchParams.set("next", `${pathname}${request.nextUrl.search}`);
    return NextResponse.redirect(loginUrl);
  }

  if (hasToken && isPublicPath) {
    return NextResponse.redirect(new URL(homeForToken(token), request.url));
  }

  if (hasToken && tokenAudience(token) === "partner" && partnerOutsideZone(pathname)) {
    return NextResponse.redirect(new URL(PARTNER_PORTAL_HOME, request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|webp)$).*)"],
};
