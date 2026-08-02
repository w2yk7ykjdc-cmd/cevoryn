import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { getMembership, getUser } from "@/lib/auth";
import { captureServerError } from "@/lib/error-reporting";
import {
  createGoogleAuthorizationUrl,
  createOAuthState,
} from "@/lib/google-oauth";

function settingsErrorUrl(request: NextRequest): URL {
  return new URL("/settings?google=error", request.url);
}

export async function GET(request: NextRequest) {
  try {
    const user = await getUser();
    if (!user) return NextResponse.redirect(settingsErrorUrl(request));

    const membership = await getMembership(user.id);
    if (!membership) return NextResponse.redirect(settingsErrorUrl(request));

    const state = createOAuthState();
    const cookieStore = await cookies();
    cookieStore.set("atlas_google_oauth_state", state, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 10 * 60,
    });

    return NextResponse.redirect(createGoogleAuthorizationUrl(state));
  } catch (error) {
    captureServerError("google-connect", error);
    return NextResponse.redirect(settingsErrorUrl(request));
  }
}
