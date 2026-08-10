import { NextResponse, type NextRequest } from "next/server";

const PUBLIC_PATHS = ["/login", "/forgot-password", "/reset-password"];

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
