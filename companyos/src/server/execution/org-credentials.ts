import { getTenantScopedClient } from "@/server/db/tenant";
import { recordExecutionAudit } from "@/server/execution/audit";
import { hasLiveCredentials as hasEnvCredentials, getCredentials as getEnvCredentials, type BinanceCredentials } from "@/server/execution/credentials";
import { decryptSecret, encryptSecret, fingerprint } from "@/server/execution/credential-crypto";
import { DEFAULT_EXECUTION_PROVIDER } from "@/server/execution/providers";

/**
 * Sprint 23 Phase 2: organization-scoped credentials -- the primary
 * credential source, replacing Sprint 22's single, deployment-wide
 * `BINANCE_API_KEY`/`BINANCE_API_SECRET` env vars for any organization
 * that has configured its own. The env vars remain as a fallback ONLY for
 * an organization that has never configured (or has revoked) its own
 * credential for the `"binance"` provider specifically -- the env fallback
 * is inherently Binance-only (Sprint 22's own env vars), never a way to
 * override or blend with an organization's own configured credential for
 * ANY provider. This module is the ONLY place
 * `OrganizationExecutionCredential` rows are read or written;
 * `execution/credentials.ts`'s existing env-only functions are untouched
 * and remain the fallback layer this module calls into.
 *
 * Sprint 27: every function below gained an optional `provider` parameter
 * defaulting to `DEFAULT_EXECUTION_PROVIDER` ("binance") -- every existing
 * Sprint 23-26 call site that never passes it keeps reading/writing the
 * exact same row it always has (the row's own `provider` column already
 * defaults to "binance" too). An organization can now hold ONE credential
 * PER provider (`@@unique([organizationId, provider])`), never more than
 * one for the same provider, and never a way for one provider's credential
 * to be read under another provider's name.
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
  /** Defaults to `"binance"` -- see the module doc comment. */
  provider?: string;
};

/**
 * Creates or ROTATES this organization's credential for `provider`.
 * Rotating (calling this when a row already exists for this exact
 * organization+provider pair) overwrites the encrypted values, clears
 * `revokedAt` (a previously revoked organization can re-enable live
 * execution by configuring a fresh credential), and bumps `rotatedAt`. The
 * audit row records only the new fingerprint and whether this was a
 * create or a rotation -- NEVER the plaintext or ciphertext.
 */
export async function setOrganizationCredentials(input: SetOrganizationCredentialsInput): Promise<{ isRotation: boolean }> {
  const { organizationId, actorId, apiKey, apiSecret } = input;
  const provider = input.provider ?? DEFAULT_EXECUTION_PROVIDER;
  const scoped = getTenantScopedClient(organizationId);

  const existing = await scoped.organizationExecutionCredential.findUnique({ where: { organizationId_provider: { organizationId, provider } } });
  const isRotation = existing !== null;

  const data = {
    organizationId,
    provider,
    encryptedApiKey: encryptSecret(apiKey),
    encryptedApiSecret: encryptSecret(apiSecret),
    apiKeyFingerprint: fingerprint(apiKey),
    createdById: actorId,
    rotatedAt: isRotation ? new Date() : null,
    revokedAt: null,
    revokedById: null,
  };

  if (isRotation) {
    await scoped.organizationExecutionCredential.update({ where: { organizationId_provider: { organizationId, provider } }, data });
  } else {
    await scoped.organizationExecutionCredential.create({ data });
  }

  await recordExecutionAudit({
    organizationId,
    action: isRotation ? "execution.credentials_rotated" : "execution.credentials_configured",
    clientOrderId: organizationId,
    symbol: "n/a",
    metadata: { fingerprint: data.apiKeyFingerprint, provider },
  });

  return { isRotation };
}

/**
 * Soft-revokes this organization's credential for `provider` -- the row is
 * kept (a real audit history of when credentials existed and were
 * revoked) but every read path below treats a revoked row as absent.
 * Idempotent: revoking an already-revoked or nonexistent credential is a
 * no-op, not an error.
 */
export async function revokeOrganizationCredentials(organizationId: string, actorId: string, provider: string = DEFAULT_EXECUTION_PROVIDER): Promise<void> {
  const scoped = getTenantScopedClient(organizationId);
  const existing = await scoped.organizationExecutionCredential.findUnique({ where: { organizationId_provider: { organizationId, provider } } });
  if (!existing || existing.revokedAt) return;

  await scoped.organizationExecutionCredential.update({
    where: { organizationId_provider: { organizationId, provider } },
    data: { revokedAt: new Date(), revokedById: actorId },
  });

  await recordExecutionAudit({ organizationId, action: "execution.credentials_revoked", clientOrderId: organizationId, symbol: "n/a", metadata: { provider } });
}

/** Non-revoked organization credential for `provider`, decrypted -- `null` if none configured or revoked. Never falls back to env here; callers that want the fallback use `resolveExecutionCredentials`. */
export async function getOrganizationCredentials(organizationId: string, provider: string = DEFAULT_EXECUTION_PROVIDER): Promise<BinanceCredentials | null> {
  const scoped = getTenantScopedClient(organizationId);
  const row = await scoped.organizationExecutionCredential.findUnique({ where: { organizationId_provider: { organizationId, provider } } });
  if (!row || row.revokedAt) return null;
  return { apiKey: decryptSecret(row.encryptedApiKey), apiSecret: decryptSecret(row.encryptedApiSecret) };
}

export type OrganizationCredentialStatus = {
  provider: string;
  configured: boolean;
  fingerprint: string | null;
  rotatedAt: Date | null;
  revokedAt: Date | null;
};

/** Read-only status for a settings UI/AI-explain surface -- NEVER includes the encrypted values, let alone plaintext. */
export async function getOrganizationCredentialStatus(organizationId: string, provider: string = DEFAULT_EXECUTION_PROVIDER): Promise<OrganizationCredentialStatus> {
  const scoped = getTenantScopedClient(organizationId);
  const row = await scoped.organizationExecutionCredential.findUnique({ where: { organizationId_provider: { organizationId, provider } } });
  if (!row) return { provider, configured: false, fingerprint: null, rotatedAt: null, revokedAt: null };
  return { provider, configured: row.revokedAt === null, fingerprint: row.apiKeyFingerprint, rotatedAt: row.rotatedAt, revokedAt: row.revokedAt };
}

/** Every credential this organization has ever configured, across every provider -- status only, never the encrypted values. */
export async function listOrganizationCredentialStatuses(organizationId: string): Promise<OrganizationCredentialStatus[]> {
  const scoped = getTenantScopedClient(organizationId);
  const rows = await scoped.organizationExecutionCredential.findMany({ orderBy: { provider: "asc" } });
  return rows.map((row) => ({ provider: row.provider, configured: row.revokedAt === null, fingerprint: row.apiKeyFingerprint, rotatedAt: row.rotatedAt, revokedAt: row.revokedAt }));
}

/**
 * The single function every execution-readiness/validation call site
 * should use: this organization's own credential for `provider` if
 * configured and not revoked, otherwise the deployment-wide env fallback
 * for an organization that never opted into its own (Sprint 22's original
 * behavior, preserved -- and inherently `"binance"`-only, since the env
 * vars themselves are Binance-specific), otherwise `null`. Tenant
 * isolation is never at risk here -- the org-scoped branch can only ever
 * read THIS organization's own row.
 */
export async function resolveExecutionCredentials(organizationId: string, provider: string = DEFAULT_EXECUTION_PROVIDER): Promise<BinanceCredentials | null> {
  const org = await getOrganizationCredentials(organizationId, provider);
  if (org) return org;
  if (provider === DEFAULT_EXECUTION_PROVIDER && hasEnvCredentials()) return getEnvCredentials();
  return null;
}

export async function hasLiveCredentialsFor(organizationId: string, provider: string = DEFAULT_EXECUTION_PROVIDER): Promise<boolean> {
  return (await resolveExecutionCredentials(organizationId, provider)) !== null;
}
