import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getSessionCookie } from "better-auth/cookies";

const PUBLIC_ROUTES = ["/login", "/register", "/forgot-password", "/reset-password"];
const PUBLIC_PREFIXES = ["/api/auth", "/api/health", "/accept-invitation"];

/**
 * Optimistic auth gate. This only checks for the presence of a session
 * cookie (no DB round-trip, no signature verification) to decide whether to
 * redirect unauthenticated visitors away from the dashboard — real
 * authorization happens server-side via `requireSession`/`requirePermission`
 * in layouts, Server Actions, and route handlers. Proxy is not a substitute
 * for that; it exists purely to avoid a flash of protected UI.
 */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const isPublic =
    PUBLIC_ROUTES.includes(pathname) ||
    PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix));

  if (isPublic) {
    return NextResponse.next();
  }

  const sessionCookie = getSessionCookie(request);
  if (!sessionCookie && pathname.startsWith("/api")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!sessionCookie) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("redirect", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Match everything except static assets and Next.js internals so the
     * gate covers pages and API routes alike.
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|webp)$).*)",
  ],
};
