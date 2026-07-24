import { createServerClient } from "@supabase/ssr";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { AUTH_ROUTES, PUBLIC_ROUTES, ROUTES } from "@/lib/constants";

const LEGACY_PRODUCTION_HOST = "atlas-kemal.vercel.app";
const CANONICAL_PRODUCTION_HOST = "atlas-wb6b.vercel.app";

export async function middleware(request: NextRequest) {
  const forwardedHost = request.headers.get("x-forwarded-host");
  const rawHost = forwardedHost ?? request.headers.get("host") ?? "";
  const host = (rawHost.split(":").at(0) ?? "").toLowerCase();

  if (host === LEGACY_PRODUCTION_HOST) {
    const canonicalUrl = request.nextUrl.clone();
    canonicalUrl.protocol = "https:";
    canonicalUrl.host = CANONICAL_PRODUCTION_HOST;
    return NextResponse.redirect(canonicalUrl, 308);
  }

  const { pathname, search } = request.nextUrl;

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
      "[atlas] Supabase middleware configuration is missing; redirecting protected request to login."
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

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user && isAuthRoute) {
    return NextResponse.redirect(new URL(ROUTES.DASHBOARD, request.url));
  }

  if (!user && !isPublicRoute) {
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