import crypto from "node:crypto";

import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { requireMembership, requireUser } from "@/lib/auth";
import {
  encryptGoogleToken,
  exchangeGoogleCode,
  fetchGoogleEmail,
  getGoogleSettingsUrl,
} from "@/lib/google-oauth";
import { prisma } from "@/lib/prisma";

type StoredRefreshToken = {
  refresh_token_encrypted: string | null;
};

function hasValidState(state: string | null, expectedState: string | undefined) {
  if (!state || !expectedState) return false;

  const actual = Buffer.from(state);
  const expected = Buffer.from(expectedState);
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function settingsErrorUrl(request: NextRequest): URL {
  return new URL("/settings?google=error", request.url);
}

export async function GET(request: NextRequest) {
  try {
    const providerError = request.nextUrl.searchParams.get("error");
    const code = request.nextUrl.searchParams.get("code");
    const state = request.nextUrl.searchParams.get("state");
    const cookieStore = await cookies();
    const expectedState = cookieStore.get("atlas_google_oauth_state")?.value;

    cookieStore.delete("atlas_google_oauth_state");

    if (providerError || !code || !hasValidState(state, expectedState)) {
      return NextResponse.redirect(settingsErrorUrl(request));
    }

    const user = await requireUser();
    const membership = await requireMembership(user.id);
    const tokens = await exchangeGoogleCode(code);
    const googleEmail = await fetchGoogleEmail(tokens.access_token);

    const existing = await prisma.$queryRaw<StoredRefreshToken[]>`
      SELECT "refresh_token_encrypted"
      FROM "google_connections"
      WHERE "organization_id" = ${membership.organizationId}
        AND "user_id" = ${user.id}
      LIMIT 1
    `;

    const accessTokenEncrypted = encryptGoogleToken(tokens.access_token);
    const refreshTokenEncrypted = tokens.refresh_token
      ? encryptGoogleToken(tokens.refresh_token)
      : (existing[0]?.refresh_token_encrypted ?? null);
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
        NOW(),
        NOW()
      )
      ON CONFLICT ("organization_id", "user_id")
      DO UPDATE SET
        "google_email" = EXCLUDED."google_email",
        "access_token_encrypted" = EXCLUDED."access_token_encrypted",
        "refresh_token_encrypted" = EXCLUDED."refresh_token_encrypted",
        "expires_at" = EXCLUDED."expires_at",
        "scopes" = EXCLUDED."scopes",
        "updated_at" = NOW()
    `;

    return NextResponse.redirect(getGoogleSettingsUrl("connected"));
  } catch (error) {
    console.error(
      "[cevoryn:google] callback failed",
      error instanceof Error ? error.message : "unknown"
    );
    return NextResponse.redirect(settingsErrorUrl(request));
  }
}
