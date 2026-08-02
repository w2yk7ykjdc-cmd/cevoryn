import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";
import { getAppHost } from "@/lib/canonical-origin";

// These are the app's own dynamic metadata routes (src/app/sitemap.ts,
// src/app/robots.ts) - they read the request's Host header themselves to
// scope their output to the current custom domain, so they must be left
// alone here rather than rewritten into the domain-view catch-all (which
// has no page matching these paths and would just 404).
const HOST_AWARE_ROUTES = new Set(["/sitemap.xml", "/robots.txt"]);

export async function proxy(request: NextRequest) {
  const host = request.headers.get("host")?.split(":")[0];
  const appHost = getAppHost();

  // Traffic arriving on a customer's own custom domain has no project slug
  // in its URL. Rewrite it to the domain-resolving route instead of the
  // Supabase session flow below - that route runs on the Node.js runtime
  // and can query Postgres directly, which this Edge middleware cannot.
  if (
    host &&
    host !== appHost &&
    !host.endsWith(".vercel.app") &&
    host !== "localhost" &&
    !HOST_AWARE_ROUTES.has(request.nextUrl.pathname)
  ) {
    const url = request.nextUrl.clone();
    url.pathname = `/domain-view/${host}${url.pathname}`;
    return NextResponse.rewrite(url);
  }

  return updateSession(request);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
