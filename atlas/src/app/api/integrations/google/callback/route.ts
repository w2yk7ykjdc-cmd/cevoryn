import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { requireMembership, requireUser } from "@/lib/auth";
import {
  encryptGoogleToken,
  exchangeGoogleCode,
  fetchGoogleEmail,
} from "@/lib/google-oauth";
import { prisma } from "@/lib/prisma";

export async function GET(request: NextRequest) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  const settingsUrl = new URL("/settings", appUrl);

  try {
    const error = request.nextUrl.searchParams.get("error");
    const code = request.nextUrl.searchParams.get("code");
    const state = request.nextUrl.searchParams.get("state");
    const cookieStore = await cookies();
    const expectedState = cookieStore.get("atlas_google_oauth_state")?.value;
    cookieStore.delete("atlas_google_oauth_state");

    if (error || !code || !state || !expectedState || state !== expectedState) {
      settingsUrl.searchParams.set("google", "error");
      return NextResponse.redirect(settingsUrl);
    }

    const user = await requireUser();
    const membership = await requireMembership(user.id);
    const tokens = await exchangeGoogleCode(code);
    const googleEmail = await fetchGoogleEmail(tokens.access_token);

    const existing = await prisma.googleConnection.findUnique({
      where: {
        organizationId_userId: {
          organizationId: membership.organizationId,
          userId: user.id,
        },
      },
      select: { refreshTokenEncrypted: true },
    });

    await prisma.googleConnection.upsert({
      where: {
        organizationId_userId: {
          organizationId: membership.organizationId,
          userId: user.id,
        },
      },
      create: {
        organizationId: membership.organizationId,
        userId: user.id,
        googleEmail,
        accessTokenEncrypted: encryptGoogleToken(tokens.access_token),
        refreshTokenEncrypted: tokens.refresh_token
          ? encryptGoogleToken(tokens.refresh_token)
          : null,
        expiresAt: new Date(Date.now() + tokens.expires_in * 1000),
        scopes: tokens.scope,
      },
      update: {
        googleEmail,
        accessTokenEncrypted: encryptGoogleToken(tokens.access_token),
        refreshTokenEncrypted: tokens.refresh_token
          ? encryptGoogleToken(tokens.refresh_token)
          : existing?.refreshTokenEncrypted,
        expiresAt: new Date(Date.now() + tokens.expires_in * 1000),
        scopes: tokens.scope,
      },
    });

    settingsUrl.searchParams.set("google", "connected");
    return NextResponse.redirect(settingsUrl);
  } catch (error) {
    console.error("[atlas:google] callback failed", error);
    settingsUrl.searchParams.set("google", "error");
    return NextResponse.redirect(settingsUrl);
  }
}
