import { NextResponse, type NextRequest } from "next/server";

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

  const hasToken = Boolean(request.cookies.get("oms_token")?.value);
  const isPublicPath = PUBLIC_PATHS.some((path) => pathname.startsWith(path));

  if (!hasToken && !isPublicPath) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  if (hasToken && isPublicPath) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|webp)$).*)"],
};
