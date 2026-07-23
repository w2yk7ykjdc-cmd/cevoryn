import crypto from "node:crypto";

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
    const accessTokenEncrypted = encryptGoogleToken(tokens.access_token);
    const refreshTokenEncrypted = tokens.refresh_token
      ? encryptGoogleToken(tokens.refresh_token)
      : null;
    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);

    await prisma.$executeRaw`
      INSERT INTO "google_connections" (
        "id",
        "organization_id",
        "user_id",
        "google_email",
        "access_token_encrypted",
        "refresh_token_encrypted",
        "expires_at",
        "scopes",
        "created_at",
        "updated_at"
      ) VALUES (
        ${crypto.randomUUID()},
        ${membership.organizationId},
        ${user.id},
        ${googleEmail},
        ${accessTokenEncrypted},
        ${refreshTokenEncrypted},
        ${expiresAt},
        ${tokens.scope},
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
      )
      ON CONFLICT ("organization_id", "user_id") DO UPDATE SET
        "google_email" = EXCLUDED."google_email",
        "access_token_encrypted" = EXCLUDED."access_token_encrypted",
        "refresh_token_encrypted" = COALESCE(
          EXCLUDED."refresh_token_encrypted",
          "google_connections"."refresh_token_encrypted"
        ),
        "expires_at" = EXCLUDED."expires_at",
        "scopes" = EXCLUDED."scopes",
        "updated_at" = CURRENT_TIMESTAMP
    `;

    settingsUrl.searchParams.set("google", "connected");
    return NextResponse.redirect(settingsUrl);
  } catch (error) {
    console.error("[atlas:google] callback failed", error);
    settingsUrl.searchParams.set("google", "error");
    return NextResponse.redirect(settingsUrl);
  }
}
