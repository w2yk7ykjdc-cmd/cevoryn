import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Not tied to any organization (infra/deploy diagnostic) so this reuses the
 * CRON_SECRET bearer-token pattern the cron routes use, rather than an org
 * admin session. This endpoint returns real infra fingerprinting detail
 * (Node version, which secrets are configured, commit SHA) that should
 * never be reachable by an anonymous caller.
 */
function isAuthorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return false;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json(
      { error: { code: "UNAUTHORIZED", message: "Not authenticated" } },
      { status: 401 }
    );
  }

  return NextResponse.json(
    {
      ok: true,
      service: "cevoryn",
      check: "runtime",
      timestamp: new Date().toISOString(),
      node: process.version,
      environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "unknown",
      commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
      config: {
        databaseUrl: Boolean(process.env.DATABASE_URL),
        supabaseUrl: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL),
        supabaseAnonKey: Boolean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
        openAiKey: Boolean(process.env.OPENAI_API_KEY),
        appUrl: process.env.NEXT_PUBLIC_APP_URL ?? null,
      },
    },
    {
      status: 200,
      headers: {
        "Cache-Control": "no-store, max-age=0",
      },
    }
  );
}
