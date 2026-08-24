import { afterAll, describe, expect, it } from "vitest";
import { auth } from "@/server/auth/auth";
import { prisma } from "@/server/db/client";
import {
  createApiKey,
  hasScope,
  listApiKeys,
  mintSessionForApiKey,
  revokeApiKey,
  verifyApiKey,
} from "@/server/api-keys/service";
import { InvalidApiKeyError } from "@/server/api-keys/types";
import { POST as chatPost } from "@/app/api/ai/chat/route";
import { addMemberDirect, closeTestConnections, createOrgForUser, signUpUser } from "./helpers";

function chatRequest(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/ai/chat", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

describe("API keys", () => {
  afterAll(closeTestConnections);

  async function setup() {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    return { owner, organization };
  }

  it("createApiKey returns the plaintext key once; only its hash is ever persisted", async () => {
    const { owner, organization } = await setup();

    const { id, plaintextKey } = await createApiKey({
      organizationId: organization.id,
      actorId: owner.userId,
      name: "Test key",
      scopes: ["ai:chat"],
    });

    expect(plaintextKey).toMatch(/^cos_live_/);

    const stored = await prisma.apiKey.findUniqueOrThrow({ where: { id } });
    expect(stored.keyHash).not.toBe(plaintextKey);
    expect(plaintextKey.startsWith(stored.keyPrefix)).toBe(true);

    const auditEntry = await prisma.auditLog.findFirst({
      where: { organizationId: organization.id, action: "api_key.created", targetId: id },
    });
    expect(auditEntry?.actorId).toBe(owner.userId);
  });

  it("listApiKeys returns every key for the organization, newest first", async () => {
    const { owner, organization } = await setup();
    await createApiKey({ organizationId: organization.id, actorId: owner.userId, name: "First", scopes: [] });
    await createApiKey({ organizationId: organization.id, actorId: owner.userId, name: "Second", scopes: [] });

    const keys = await listApiKeys(organization.id);
    expect(keys.map((k) => k.name)).toEqual(["Second", "First"]);
  });

  it("revokeApiKey sets revokedAt and is idempotent", async () => {
    const { owner, organization } = await setup();
    const { id } = await createApiKey({ organizationId: organization.id, actorId: owner.userId, name: "K", scopes: [] });

    await revokeApiKey(organization.id, id, owner.userId);
    const revoked = await prisma.apiKey.findUniqueOrThrow({ where: { id } });
    expect(revoked.revokedAt).not.toBeNull();

    await expect(revokeApiKey(organization.id, id, owner.userId)).resolves.toBeUndefined();

    const auditEntries = await prisma.auditLog.findMany({
      where: { organizationId: organization.id, action: "api_key.revoked", targetId: id },
    });
    expect(auditEntries).toHaveLength(1); // the idempotent second call didn't log again
  });

  it("verifyApiKey rejects an unknown token", async () => {
    await expect(verifyApiKey("cos_live_not_a_real_key")).rejects.toThrow(InvalidApiKeyError);
  });

  it("verifyApiKey rejects a revoked key", async () => {
    const { owner, organization } = await setup();
    const { id, plaintextKey } = await createApiKey({
      organizationId: organization.id,
      actorId: owner.userId,
      name: "K",
      scopes: ["ai:chat"],
    });
    await revokeApiKey(organization.id, id, owner.userId);

    await expect(verifyApiKey(plaintextKey)).rejects.toThrow(InvalidApiKeyError);
  });

  it("verifyApiKey rejects an expired key", async () => {
    const { owner, organization } = await setup();
    const { plaintextKey } = await createApiKey({
      organizationId: organization.id,
      actorId: owner.userId,
      name: "K",
      scopes: ["ai:chat"],
      expiresAt: new Date(Date.now() - 60_000),
    });

    await expect(verifyApiKey(plaintextKey)).rejects.toThrow(InvalidApiKeyError);
  });

  it("verifyApiKey succeeds for a live key, filters scopes, and records lastUsedAt", async () => {
    const { owner, organization } = await setup();
    const { id, plaintextKey } = await createApiKey({
      organizationId: organization.id,
      actorId: owner.userId,
      name: "K",
      scopes: ["ai:chat"],
    });

    const before = await prisma.apiKey.findUniqueOrThrow({ where: { id } });
    expect(before.lastUsedAt).toBeNull();

    const verified = await verifyApiKey(plaintextKey);
    expect(verified.organizationId).toBe(organization.id);
    expect(verified.userId).toBe(owner.userId);
    expect(hasScope(verified, "ai:chat")).toBe(true);

    const after = await prisma.apiKey.findUniqueOrThrow({ where: { id } });
    expect(after.lastUsedAt).not.toBeNull();
  });

  it("mintSessionForApiKey's session reflects the key creator's real, current organization role — not a fixed grant", async () => {
    const { owner, organization } = await setup();
    const viewer = await signUpUser();
    await addMemberDirect(organization.id, viewer, "viewer");

    // A key attributed to the owner: owner role has aiConversation:create.
    const ownerKey = await createApiKey({
      organizationId: organization.id,
      actorId: owner.userId,
      name: "Owner key",
      scopes: ["ai:chat"],
    });
    const ownerVerified = await verifyApiKey(ownerKey.plaintextKey);
    const ownerToken = await mintSessionForApiKey(ownerVerified);
    const ownerPermitted = await auth.api.hasPermission({
      headers: new Headers({ authorization: `Bearer ${ownerToken}` }),
      body: { organizationId: organization.id, permissions: { aiConversation: ["create"] } },
    });
    expect(ownerPermitted.success).toBe(true);

    // A key attributed to a viewer: viewer role has no aiConversation:create.
    // (Simulates a key whose creator was later demoted — the key's effective
    // permissions track the person's *current* role, not what they had when
    // the key was minted.)
    const viewerKey = await createApiKey({
      organizationId: organization.id,
      actorId: viewer.userId,
      name: "Viewer key",
      scopes: ["ai:chat"],
    });
    const viewerVerified = await verifyApiKey(viewerKey.plaintextKey);
    const viewerToken = await mintSessionForApiKey(viewerVerified);
    const viewerPermitted = await auth.api.hasPermission({
      headers: new Headers({ authorization: `Bearer ${viewerToken}` }),
      body: { organizationId: organization.id, permissions: { aiConversation: ["create"] } },
    });
    expect(viewerPermitted.success).toBe(false);
  });

  it("POST /api/ai/chat rejects requests with no session and no Authorization header", async () => {
    const response = await chatPost(chatRequest({ message: "hi" }));
    expect(response.status).toBe(401);
  });

  it("POST /api/ai/chat rejects an unknown bearer token", async () => {
    const response = await chatPost(chatRequest({ message: "hi" }, { authorization: "Bearer cos_live_bogus" }));
    expect(response.status).toBe(401);
  });

  it("POST /api/ai/chat rejects a revoked API key", async () => {
    const { owner, organization } = await setup();
    const { id, plaintextKey } = await createApiKey({
      organizationId: organization.id,
      actorId: owner.userId,
      name: "K",
      scopes: ["ai:chat"],
    });
    await revokeApiKey(organization.id, id, owner.userId);

    const response = await chatPost(chatRequest({ message: "hi" }, { authorization: `Bearer ${plaintextKey}` }));
    expect(response.status).toBe(401);
  });

  it("POST /api/ai/chat rejects an API key that lacks the ai:chat scope", async () => {
    const { owner, organization } = await setup();
    const { plaintextKey } = await createApiKey({
      organizationId: organization.id,
      actorId: owner.userId,
      name: "Scopeless key",
      scopes: [],
    });

    const response = await chatPost(chatRequest({ message: "hi" }, { authorization: `Bearer ${plaintextKey}` }));
    expect(response.status).toBe(403);
  });

  it("POST /api/ai/chat accepts a valid API key with the ai:chat scope — auth passes, and it only fails past that point because no AI provider is configured in this environment", async () => {
    const { owner, organization } = await setup();
    const { plaintextKey } = await createApiKey({
      organizationId: organization.id,
      actorId: owner.userId,
      name: "K",
      scopes: ["ai:chat"],
    });

    const response = await chatPost(chatRequest({ message: "hi" }, { authorization: `Bearer ${plaintextKey}` }));
    // Not 401/403 (auth+scope passed); 502 is the documented "no AI
    // provider configured" outcome the rest of the AI suite hits too.
    expect(response.status).toBe(502);
  });
});
