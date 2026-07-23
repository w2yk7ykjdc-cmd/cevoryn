import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { ROUTES } from "@/lib/constants";
import { createClient } from "@/lib/supabase/server";

function getSafeNextPath(value: string | null): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return ROUTES.DASHBOARD;
  }

  return value;
}

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = getSafeNextPath(searchParams.get("next"));
  const supabase = await createClient();

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      return NextResponse.redirect(new URL(next, origin));
    }
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    return NextResponse.redirect(new URL(next, origin));
  }

  const providerError =
    searchParams.get("error_description") ?? searchParams.get("error");
  const loginUrl = new URL(ROUTES.LOGIN, origin);
  loginUrl.searchParams.set(
    "error",
    providerError ? "oauth_cancelled_or_denied" : "auth_callback_error"
  );

  return NextResponse.redirect(loginUrl);
}
