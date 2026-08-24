import { createHash, randomBytes, randomUUID } from "node:crypto";
import { prisma } from "@/server/db/client";
import { recordAuditLog } from "@/server/audit/audit-log";
import { type ApiKeyScope, ApiKeyNotFoundError, InvalidApiKeyError, isApiKeyScope } from "@/server/api-keys/types";

const KEY_PREFIX = "cos_live_";

/**
 * API keys are high-entropy random tokens, not user-chosen passwords, so a
 * single fast SHA-256 hash (rather than bcrypt/argon2) is the right
 * tradeoff: lookup happens on every authenticated request, and there's no
 * meaningful brute-force surface to slow down when the input already has
 * 256 bits of entropy.
 */
function hashKey(rawKey: string): string {
  return createHash("sha256").update(rawKey).digest("hex");
}

export type CreateApiKeyInput = {
  organizationId: string;
  actorId: string;
  name: string;
  scopes: ApiKeyScope[];
  expiresAt?: Date | null;
};

export type CreatedApiKey = {
  id: string;
  /** The full bearer token. Only ever returned here — `keyHash` is all that's persisted, so this is the caller's one chance to see it. */
  plaintextKey: string;
};

export async function createApiKey(input: CreateApiKeyInput): Promise<CreatedApiKey> {
  const secret = randomBytes(32).toString("base64url");
  const plaintextKey = `${KEY_PREFIX}${secret}`;
  const keyPrefix = `${KEY_PREFIX}${secret.slice(0, 8)}`;

  const apiKey = await prisma.apiKey.create({
    data: {
      organizationId: input.organizationId,
      createdById: input.actorId,
      name: input.name,
      keyPrefix,
      keyHash: hashKey(plaintextKey),
      scopes: input.scopes,
      expiresAt: input.expiresAt ?? null,
    },
  });

  await recordAuditLog({
    organizationId: input.organizationId,
    actorId: input.actorId,
    actorType: "user",
    action: "api_key.created",
    targetType: "api_key",
    targetId: apiKey.id,
    metadata: { name: input.name, scopes: input.scopes, keyPrefix },
  });

  return { id: apiKey.id, plaintextKey };
}

export async function listApiKeys(organizationId: string) {
  return prisma.apiKey.findMany({
    where: { organizationId },
    orderBy: { createdAt: "desc" },
    include: { createdBy: { select: { name: true, email: true } } },
  });
}

export async function revokeApiKey(organizationId: string, apiKeyId: string, actorId: string): Promise<void> {
  const apiKey = await prisma.apiKey.findFirst({ where: { id: apiKeyId, organizationId } });
  if (!apiKey) {
    throw new ApiKeyNotFoundError(apiKeyId);
  }
  if (apiKey.revokedAt) {
    return; // already revoked — idempotent, not an error
  }

  await prisma.apiKey.update({ where: { id: apiKeyId }, data: { revokedAt: new Date() } });

  await recordAuditLog({
    organizationId,
    actorId,
    actorType: "user",
    action: "api_key.revoked",
    targetType: "api_key",
    targetId: apiKeyId,
    metadata: { name: apiKey.name },
  });
}

export type VerifiedApiKey = {
  apiKeyId: string;
  organizationId: string;
  /** The key's creator. Requests authenticated by this key are attributed to them — an API key has no separate identity of its own. */
  userId: string;
  scopes: ApiKeyScope[];
};

/**
 * Verifies a raw `Authorization: Bearer <key>` value against the stored
 * hash. Throws `InvalidApiKeyError` for any reason the key doesn't work —
 * unknown, revoked, or expired are deliberately indistinguishable to the
 * caller, and updates `lastUsedAt` on success so revocation candidates are
 * visible in the UI.
 */
export async function verifyApiKey(rawKey: string): Promise<VerifiedApiKey> {
  const apiKey = await prisma.apiKey.findUnique({ where: { keyHash: hashKey(rawKey) } });
  if (!apiKey || apiKey.revokedAt || (apiKey.expiresAt && apiKey.expiresAt.getTime() < Date.now())) {
    throw new InvalidApiKeyError();
  }

  await prisma.apiKey.update({ where: { id: apiKey.id }, data: { lastUsedAt: new Date() } });

  return {
    apiKeyId: apiKey.id,
    organizationId: apiKey.organizationId,
    userId: apiKey.createdById,
    scopes: apiKey.scopes.filter(isApiKeyScope),
  };
}

export function hasScope(key: VerifiedApiKey, scope: ApiKeyScope): boolean {
  return key.scopes.includes(scope);
}

/**
 * Mints a short-lived Better Auth session for `key.userId`, scoped to the
 * key's organization, and returns its bearer token. This is what lets an
 * API-key-authenticated request flow through the exact same RBAC path as a
 * real user — every downstream permission check (the Tool Engine's
 * `hasPermission` calls included) reads this session, so an API key can
 * only ever do what its creator's own role already permits. No changes to
 * Sprint 0's RBAC/Tool Engine internals were needed to support this.
 *
 * The session is scoped to a single request: 5 minutes is enough for even
 * a slow multi-round tool-calling turn to finish, short enough that a
 * leaked token is a non-issue by the time anyone could reuse it.
 */
export async function mintSessionForApiKey(key: VerifiedApiKey): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await prisma.session.create({
    data: {
      id: randomUUID(),
      token,
      userId: key.userId,
      activeOrganizationId: key.organizationId,
      expiresAt: new Date(Date.now() + 5 * 60 * 1000),
      userAgent: "api-key",
    },
  });
  return token;
}
