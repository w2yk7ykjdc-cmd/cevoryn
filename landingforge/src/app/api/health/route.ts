import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const isProd = process.env.NODE_ENV === "production";

  let database: { ok: boolean; error: string | null };
  try {
    await prisma.user.count();
    database = { ok: true, error: null };
  } catch (e) {
    database = {
      ok: false,
      error: isProd ? null : e instanceof Error ? e.message : String(e),
    };
  }

  let supabaseConnection: { ok: boolean; error: string | null };
  try {
    const supabase = await createClient();
    const { error } = await supabase.auth.getUser();
    // A missing session isn't a connection failure - any response at all
    // (even "no user") means Supabase answered the request.
    supabaseConnection = { ok: true, error: isProd ? null : (error?.message ?? null) };
  } catch (e) {
    supabaseConnection = {
      ok: false,
      error: isProd ? null : e instanceof Error ? e.message : String(e),
    };
  }

  // Deployment metadata, env-var presence flags, and raw error text are
  // only useful for local/staging debugging - in production they're
  // unauthenticated information disclosure, so this endpoint stays
  // reachable for uptime monitors but only exposes the ok/error shape.
  if (isProd) {
    return NextResponse.json({ supabaseConnection, database });
  }

  const deployment = {
    gitCommitSha: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
    gitCommitMessage: process.env.VERCEL_GIT_COMMIT_MESSAGE ?? null,
    deploymentId: process.env.VERCEL_DEPLOYMENT_ID ?? null,
  };

  const envVarPresent = {
    NEXT_PUBLIC_SUPABASE_URL: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL),
    NEXT_PUBLIC_SUPABASE_ANON_KEY: Boolean(
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    ),
    SUPABASE_SERVICE_ROLE_KEY: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
    DATABASE_URL: Boolean(process.env.DATABASE_URL),
    DIRECT_URL: Boolean(process.env.DIRECT_URL),
    NEXT_PUBLIC_APP_URL: Boolean(process.env.NEXT_PUBLIC_APP_URL),
    PADDLE_API_KEY: Boolean(process.env.PADDLE_API_KEY),
    PADDLE_WEBHOOK_SECRET: Boolean(process.env.PADDLE_WEBHOOK_SECRET),
    OPENAI_API_KEY: Boolean(process.env.OPENAI_API_KEY),
  };

  return NextResponse.json({ deployment, envVarPresent, supabaseConnection, database });
}
