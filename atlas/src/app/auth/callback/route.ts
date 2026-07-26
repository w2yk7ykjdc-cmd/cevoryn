import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { ROUTES } from "@/lib/constants";
import { getSafeRedirectPath } from "@/lib/safe-redirect";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = getSafeRedirectPath(searchParams.get("next"), ROUTES.DASHBOARD);
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

  if (next === ROUTES.RESET_PASSWORD) {
    const recoveryUrl = new URL(ROUTES.FORGOT_PASSWORD, origin);
    recoveryUrl.searchParams.set("error", "invalid_or_expired_reset_link");
    return NextResponse.redirect(recoveryUrl);
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
