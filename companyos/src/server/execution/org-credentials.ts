import { getTenantScopedClient } from "@/server/db/tenant";
import { recordExecutionAudit } from "@/server/execution/audit";
import { hasLiveCredentials as hasEnvCredentials, getCredentials as getEnvCredentials, type BinanceCredentials } from "@/server/execution/credentials";
import { decryptSecret, encryptSecret, fingerprint } from "@/server/execution/credential-crypto";

/**
 * Sprint 23 Phase 2: organization-scoped Binance credentials -- the
 * primary credential source, replacing Sprint 22's single,
 * deployment-wide `BINANCE_API_KEY`/`BINANCE_API_SECRET` env vars for any
 * organization that has configured its own. The env vars remain as a
 * fallback ONLY for an organization that has never configured (or has
 * revoked) its own credential -- never as a way to override or blend with
 * an organization's own configured credential. This module is the ONLY
 * place `OrganizationExecutionCredential` rows are read or written;
 * `execution/credentials.ts`'s existing env-only functions are untouched
 * and remain the fallback layer this module calls into.
 *
 * Every read goes through `getTenantScopedClient(organizationId)` --
 * `OrganizationExecutionCredential` is tenant-scoped in `tenant.ts` exactly
 * like every other model, so an attempt to read/write another
 * organization's row throws `CrossTenantAccessError` rather than silently
 * returning or overwriting it.
 */

export type SetOrganizationCredentialsInput = {
  organizationId: string;
  actorId: string;
  apiKey: string;
  apiSecret: string;
};

/**
 * Creates or ROTATES this organization's credential. Rotating (calling
 * this when a row already exists) overwrites the encrypted values,
 * clears `revokedAt` (a previously revoked organization can re-enable live
 * execution by configuring a fresh credential), and bumps `rotatedAt`.
 * The audit row records only the new fingerprint and whether this was a
 * create or a rotation -- NEVER the plaintext or ciphertext.
 */
export async function setOrganizationCredentials(input: SetOrganizationCredentialsInput): Promise<{ isRotation: boolean }> {
  const { organizationId, actorId, apiKey, apiSecret } = input;
  const scoped = getTenantScopedClient(organizationId);

  const existing = await scoped.organizationExecutionCredential.findUnique({ where: { organizationId } });
  const isRotation = existing !== null;

  const data = {
    organizationId,
    provider: "binance",
    encryptedApiKey: encryptSecret(apiKey),
    encryptedApiSecret: encryptSecret(apiSecret),
    apiKeyFingerprint: fingerprint(apiKey),
    createdById: actorId,
    rotatedAt: isRotation ? new Date() : null,
    revokedAt: null,
    revokedById: null,
  };

  if (isRotation) {
    await scoped.organizationExecutionCredential.update({ where: { organizationId }, data });
  } else {
    await scoped.organizationExecutionCredential.create({ data });
  }

  await recordExecutionAudit({
    organizationId,
    action: isRotation ? "execution.credentials_rotated" : "execution.credentials_configured",
    clientOrderId: organizationId,
    symbol: "n/a",
    metadata: { fingerprint: data.apiKeyFingerprint },
  });

  return { isRotation };
}

/**
 * Soft-revokes this organization's credential -- the row is kept (a real
 * audit history of when credentials existed and were revoked) but every
 * read path below treats a revoked row as absent. Idempotent: revoking an
 * already-revoked or nonexistent credential is a no-op, not an error.
 */
export async function revokeOrganizationCredentials(organizationId: string, actorId: string): Promise<void> {
  const scoped = getTenantScopedClient(organizationId);
  const existing = await scoped.organizationExecutionCredential.findUnique({ where: { organizationId } });
  if (!existing || existing.revokedAt) return;

  await scoped.organizationExecutionCredential.update({
    where: { organizationId },
    data: { revokedAt: new Date(), revokedById: actorId },
  });

  await recordExecutionAudit({ organizationId, action: "execution.credentials_revoked", clientOrderId: organizationId, symbol: "n/a" });
}

/** Non-revoked organization credential, decrypted -- `null` if none configured or revoked. Never falls back to env here; callers that want the fallback use `resolveExecutionCredentials`. */
export async function getOrganizationCredentials(organizationId: string): Promise<BinanceCredentials | null> {
  const scoped = getTenantScopedClient(organizationId);
  const row = await scoped.organizationExecutionCredential.findUnique({ where: { organizationId } });
  if (!row || row.revokedAt) return null;
  return { apiKey: decryptSecret(row.encryptedApiKey), apiSecret: decryptSecret(row.encryptedApiSecret) };
}

export type OrganizationCredentialStatus = {
  configured: boolean;
  fingerprint: string | null;
  rotatedAt: Date | null;
  revokedAt: Date | null;
};

/** Read-only status for a settings UI/AI-explain surface -- NEVER includes the encrypted values, let alone plaintext. */
export async function getOrganizationCredentialStatus(organizationId: string): Promise<OrganizationCredentialStatus> {
  const scoped = getTenantScopedClient(organizationId);
  const row = await scoped.organizationExecutionCredential.findUnique({ where: { organizationId } });
  if (!row) return { configured: false, fingerprint: null, rotatedAt: null, revokedAt: null };
  return { configured: row.revokedAt === null, fingerprint: row.apiKeyFingerprint, rotatedAt: row.rotatedAt, revokedAt: row.revokedAt };
}

/**
 * The single function every execution-readiness/validation call site
 * should use: this organization's own credential if configured and not
 * revoked, otherwise the deployment-wide env fallback (Sprint 22's
 * original behavior, preserved for an organization that never opted into
 * its own), otherwise `null`. Tenant isolation is never at risk here --
 * the org-scoped branch can only ever read THIS organization's own row.
 */
export async function resolveExecutionCredentials(organizationId: string): Promise<BinanceCredentials | null> {
  const org = await getOrganizationCredentials(organizationId);
  if (org) return org;
  if (hasEnvCredentials()) return getEnvCredentials();
  return null;
}

export async function hasLiveCredentialsFor(organizationId: string): Promise<boolean> {
  return (await resolveExecutionCredentials(organizationId)) !== null;
}
