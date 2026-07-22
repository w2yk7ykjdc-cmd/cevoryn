import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { requireMembership, requireUser } from "@/lib/auth";
import {
  createGoogleAuthorizationUrl,
  createOAuthState,
} from "@/lib/google-oauth";

export async function GET() {
  try {
    const user = await requireUser();
    await requireMembership(user.id);

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
    console.error("[atlas:google] connect failed", error);
    return NextResponse.redirect(
      new URL("/settings?google=error", process.env.NEXT_PUBLIC_APP_URL)
    );
  }
}
