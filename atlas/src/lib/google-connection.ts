import "server-only";

import { captureServerError } from "@/lib/error-reporting";
import {
  decryptGoogleToken,
  encryptGoogleToken,
  refreshGoogleAccessToken,
} from "@/lib/google-oauth";
import { prisma } from "@/lib/prisma";

type GoogleConnectionRow = {
  access_token_encrypted: string;
  refresh_token_encrypted: string | null;
  expires_at: Date;
  scopes: string;
};

export class GoogleConnectionError extends Error {
  constructor(
    message: string,
    public readonly code:
      "NOT_CONNECTED" | "REFRESH_TOKEN_MISSING" | "REFRESH_FAILED"
  ) {
    super(message);
    this.name = "GoogleConnectionError";
  }
}

/**
 * Whether any member of this organization has connected Google. Used only
 * for the dashboard's onboarding-progress indicator, so a failure here
 * (e.g. the table itself being unreachable, as happened in production
 * once - see the GoogleConnection model's comment in schema.prisma) must
 * degrade to "not connected" rather than take down the caller. Isolated
 * into its own function specifically so this fallback behavior is
 * directly testable without needing the rest of loadExecutiveHome's
 * Next.js request context (next-intl/cookies()).
 */
export async function countGoogleConnections(
  organizationId: string
): Promise<number> {
  try {
    const rows = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*) AS count FROM "google_connections" WHERE "organization_id" = ${organizationId}
    `;
    return Number(rows[0]?.count ?? 0);
  } catch (error) {
    console.error(
      "[cevoryn:google-connection] google_connections lookup failed",
      error instanceof Error ? error.message : "unknown error"
    );
    return 0;
  }
}

export async function findConnectedGoogleUserId(
  organizationId: string
): Promise<string | null> {
  const rows = await prisma.$queryRaw<Array<{ user_id: string }>>`
    SELECT "user_id"
    FROM "google_connections"
    WHERE "organization_id" = ${organizationId}
    ORDER BY "updated_at" DESC
    LIMIT 1
  `;

  return rows[0]?.user_id ?? null;
}

export async function getValidGoogleAccessToken(
  organizationId: string,
  userId: string
) {
  const rows = await prisma.$queryRaw<GoogleConnectionRow[]>`
    SELECT
      "access_token_encrypted",
      "refresh_token_encrypted",
      "expires_at",
      "scopes"
    FROM "google_connections"
    WHERE "organization_id" = ${organizationId}
      AND "user_id" = ${userId}
    LIMIT 1
  `;

  const connection = rows[0];
  if (!connection) {
    throw new GoogleConnectionError(
      "Google account is not connected",
      "NOT_CONNECTED"
    );
  }

  const expiresAt = new Date(connection.expires_at).getTime();
  if (expiresAt > Date.now() + 60_000) {
    return decryptGoogleToken(connection.access_token_encrypted);
  }

  if (!connection.refresh_token_encrypted) {
    throw new GoogleConnectionError(
      "Google account must be connected again",
      "REFRESH_TOKEN_MISSING"
    );
  }

  try {
    const refreshToken = decryptGoogleToken(connection.refresh_token_encrypted);
    const refreshed = await refreshGoogleAccessToken(refreshToken);
    const encryptedAccessToken = encryptGoogleToken(refreshed.access_token);
    const newExpiresAt = new Date(Date.now() + refreshed.expires_in * 1000);
    const newScopes = refreshed.scope ?? connection.scopes;

    await prisma.$executeRaw`
      UPDATE "google_connections"
      SET
        "access_token_encrypted" = ${encryptedAccessToken},
        "expires_at" = ${newExpiresAt},
        "scopes" = ${newScopes},
        "updated_at" = NOW()
      WHERE "organization_id" = ${organizationId}
        AND "user_id" = ${userId}
    `;

    return refreshed.access_token;
  } catch (error) {
    captureServerError("google-token-refresh", error, {
      organizationId,
      userId,
    });
    throw new GoogleConnectionError(
      "Google authorization has expired; reconnect the account",
      "REFRESH_FAILED"
    );
  }
}
