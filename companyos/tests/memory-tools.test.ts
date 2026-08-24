import { afterAll, describe, expect, it } from "vitest";
import "@/server/ai/tools/builtin"; // registers remember_fact, search_memory
import { executeToolCall } from "@/server/ai/tools/executor";
import { createConversation } from "@/server/ai/runtime/conversations";
import { addMemberDirect, authHeaders, closeTestConnections, createOrgForUser, signUpUser } from "./helpers";

/**
 * `remember_fact` and `search_memory` both call out to an embedding
 * provider (`getEmbeddingProvider()`), which needs a real
 * OPENAI_API_KEY/GOOGLE_GENERATIVE_AI_API_KEY — not available in CI, the
 * same limitation the rest of the AI Sales Employee's live-model paths
 * have (see README "Verifying the AI Sales Employee end to end"). What's
 * fully verifiable here without a key: both the RBAC gate and argument
 * validation run inside `executeToolCall` *before* the handler — and
 * therefore before the embedding provider is ever reached — so a denied
 * or malformed call never touches it.
 */
describe("memory tools (remember_fact, search_memory)", () => {
  afterAll(closeTestConnections);

  async function setup() {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    const conversation = await createConversation({ organizationId: organization.id, userId: owner.userId });
    return { owner, organization, conversation };
  }

  it("remember_fact is denied for a viewer, who has no aiTool:execute permission", async () => {
    const { organization, conversation } = await setup();
    const viewer = await signUpUser();
    await addMemberDirect(organization.id, viewer, "viewer");

    const result = await executeToolCall(
      { id: "c1", name: "remember_fact", arguments: { content: "The user prefers email over calls." } },
      { organizationId: organization.id, userId: viewer.userId, conversationId: conversation.id },
      authHeaders(viewer.token),
    );

    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.error).toMatch(/permission/i);
    }
  });

  it("search_memory is denied for a viewer, who has no aiTool:execute permission", async () => {
    const { organization, conversation } = await setup();
    const viewer = await signUpUser();
    await addMemberDirect(organization.id, viewer, "viewer");

    const result = await executeToolCall(
      { id: "c2", name: "search_memory", arguments: { query: "What does the user prefer?" } },
      { organizationId: organization.id, userId: viewer.userId, conversationId: conversation.id },
      authHeaders(viewer.token),
    );

    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.error).toMatch(/permission/i);
    }
  });

  it("remember_fact rejects invalid arguments before the embedding provider is ever reached", async () => {
    const { organization, conversation, owner } = await setup();

    const result = await executeToolCall(
      { id: "c3", name: "remember_fact", arguments: { content: "" } }, // violates min(1)
      { organizationId: organization.id, userId: owner.userId, conversationId: conversation.id },
      authHeaders(owner.token),
    );

    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.error).toMatch(/invalid arguments/i);
    }
  });

  it("search_memory rejects invalid arguments before the embedding provider is ever reached", async () => {
    const { organization, conversation, owner } = await setup();

    const result = await executeToolCall(
      { id: "c4", name: "search_memory", arguments: { query: "" } }, // violates min(1)
      { organizationId: organization.id, userId: owner.userId, conversationId: conversation.id },
      authHeaders(owner.token),
    );

    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.error).toMatch(/invalid arguments/i);
    }
  });
});
