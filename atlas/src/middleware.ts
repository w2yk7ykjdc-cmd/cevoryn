import { createServerClient } from "@supabase/ssr";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { AUTH_ROUTES, PUBLIC_ROUTES, ROUTES } from "@/lib/constants";

const LEGACY_PRODUCTION_HOST = "atlas-kemal.vercel.app";
const CANONICAL_PRODUCTION_HOST = "atlas-wb6b.vercel.app";
const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function isAllowedApiMutation(request: NextRequest) {
  if (!request.nextUrl.pathname.startsWith("/api/")) return true;
  if (!MUTATING_METHODS.has(request.method.toUpperCase())) return true;

  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite === "cross-site") return false;

  const origin = request.headers.get("origin");
  if (!origin) return true;

  const allowedOrigins = new Set([request.nextUrl.origin]);
  const configuredAppUrl = process.env.NEXT_PUBLIC_APP_URL;

  if (configuredAppUrl) {
    try {
      allowedOrigins.add(new URL(configuredAppUrl).origin);
    } catch {
      console.error("[cevoryn] NEXT_PUBLIC_APP_URL is not a valid URL");
    }
  }

  const forwardedHost = request.headers.get("x-forwarded-host");
  const forwardedProto = request.headers.get("x-forwarded-proto") ?? "https";
  if (forwardedHost) {
    allowedOrigins.add(`${forwardedProto}://${forwardedHost}`);
  }

  return allowedOrigins.has(origin);
}

export async function middleware(request: NextRequest) {
  const rawHost =
    request.headers.get("x-forwarded-host") ??
    request.headers.get("host") ??
    "";
  const host = rawHost.split(":")[0]?.toLowerCase() ?? "";

  if (host === LEGACY_PRODUCTION_HOST) {
    const canonicalUrl = request.nextUrl.clone();
    canonicalUrl.protocol = "https:";
    canonicalUrl.host = CANONICAL_PRODUCTION_HOST;
    return NextResponse.redirect(canonicalUrl, 308);
  }

  const { pathname, search } = request.nextUrl;

  if (!isAllowedApiMutation(request)) {
    return NextResponse.json(
      {
        error: {
          code: "INVALID_ORIGIN",
          message: "Cross-site API mutations are not allowed",
        },
      },
      { status: 403 }
    );
  }

  const isPublicRoute = PUBLIC_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`)
  );

  const isAuthRoute = AUTH_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`)
  );

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const returnPath = `${pathname}${search}`;

  if (!supabaseUrl || !supabaseAnonKey) {
    if (isPublicRoute) {
      return NextResponse.next({ request });
    }

    console.error(
      "[cevoryn] Supabase middleware configuration is missing; redirecting protected request to login."
    );
    const loginUrl = new URL(ROUTES.LOGIN, request.url);
    loginUrl.searchParams.set("next", returnPath);
    return NextResponse.redirect(loginUrl);
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(
        cookiesToSet: {
          name: string;
          value: string;
          options?: Record<string, unknown>;
        }[]
      ) {
        cookiesToSet.forEach(({ name, value }) =>
          request.cookies.set(name, value)
        );
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options)
        );
      },
    },
  });

  // Middleware runs for every client-side route request and prefetch. Reading
  // the cookie-backed session here avoids a remote Supabase auth request on
  // every screen transition. Protected server layouts/pages still call
  // requireUser(), which validates the user with Supabase before returning data.
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (session && isAuthRoute) {
    return NextResponse.redirect(new URL(ROUTES.DASHBOARD, request.url));
  }

  if (!session && !isPublicRoute) {
    const loginUrl = new URL(ROUTES.LOGIN, request.url);
    loginUrl.searchParams.set("next", returnPath);
    return NextResponse.redirect(loginUrl);
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$|api/health).*)",
  ],
};