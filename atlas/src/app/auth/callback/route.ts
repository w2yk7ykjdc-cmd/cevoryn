import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { ROUTES } from "@/lib/constants";
import { createClient } from "@/lib/supabase/server";

function sanitizeRedirectPath(value: string | null, fallback: string): string {
  if (!value?.startsWith("/") || value.startsWith("//")) return fallback;
  try {
    const parsed = new URL(value, "https://atlas.local");
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch (_error) {
    return fallback;
  }
}

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = sanitizeRedirectPath(searchParams.get("next"), ROUTES.DASHBOARD);

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  // Auth error — redirect to login with error indicator
  const loginUrl = new URL(ROUTES.LOGIN, origin);
  loginUrl.searchParams.set("error", "auth_callback_error");
  return NextResponse.redirect(loginUrl);
}
