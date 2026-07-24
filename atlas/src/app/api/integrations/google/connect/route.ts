import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { getMembership, getUser } from "@/lib/auth";
import {
  createGoogleAuthorizationUrl,
  createOAuthState,
  getGoogleSettingsUrl,
} from "@/lib/google-oauth";

export async function GET() {
  try {
    const user = await getUser();
    if (!user) return NextResponse.redirect(getGoogleSettingsUrl("error"));

    const membership = await getMembership(user.id);
    if (!membership) return NextResponse.redirect(getGoogleSettingsUrl("error"));

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
    console.error(
      "[atlas:google] connect failed",
      error instanceof Error ? error.message : "unknown"
    );
    return NextResponse.redirect(getGoogleSettingsUrl("error"));
  }
}
