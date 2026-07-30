import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "@/lib/supabase/config";

export async function GET() {
  const diagnostics: Record<string, unknown> = {
    envVarPresent: {
      NEXT_PUBLIC_SUPABASE_URL: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL),
      NEXT_PUBLIC_SUPABASE_ANON_KEY: Boolean(
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      ),
    },
    resolvedSupabaseUrl: SUPABASE_URL,
    resolvedAnonKeyPrefix: SUPABASE_ANON_KEY.slice(0, 24) + "...",
  };

  try {
    const supabase = await createClient();
    const testEmail = `debug-${Date.now()}@example.com`;

    const { data, error } = await supabase.auth.signUp({
      email: testEmail,
      password: "Debug123456!",
    });

    diagnostics.signUpAttempt = {
      testEmail,
      ok: !error,
      error: error
        ? { message: error.message, status: error.status, name: error.name }
        : null,
      userId: data?.user?.id ?? null,
    };
  } catch (e) {
    diagnostics.signUpAttempt = {
      threw: true,
      message: e instanceof Error ? e.message : String(e),
      stack: e instanceof Error ? e.stack : undefined,
    };
  }

  return NextResponse.json(diagnostics);
}
