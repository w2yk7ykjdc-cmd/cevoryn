import { afterAll, describe, expect, it } from "vitest";
import "@/server/ai/tools/builtin";
import { createConversation } from "@/server/ai/runtime/conversations";
import { runConversationTurn, streamConversationTurn } from "@/server/ai/runtime/runtime";
import { startAgentRun } from "@/server/ai/agent/executor";
import { UsageLimitExceededError } from "@/server/billing/usage";
import { getSubscriptionForOrg } from "@/server/billing/subscription";
import { recordUsage } from "@/server/billing/usage";
import { closeTestConnections, createOrgForUser, signUpUser, authHeaders } from "./helpers";

/**
 * These exercise the pre-flight usage-limit check, which runs before either
 * `runConversationTurn` or `startAgentRun` ever resolves a real AI provider
 * — so a maxed-out organization is stopped without needing an AI provider
 * key configured in this environment, and without spending any real tokens.
 */
describe("billing: usage limit enforcement", () => {
  afterAll(closeTestConnections);

  it("runConversationTurn refuses to run once the ai_tokens limit is exhausted", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    const subscription = await getSubscriptionForOrg(organization.id);
    const conversation = await createConversation({ organizationId: organization.id, userId: owner.userId });

    await recordUsage(organization.id, "ai_tokens", subscription.plan.aiTokenLimit);

    await expect(
      runConversationTurn({
        organizationId: organization.id,
        userId: owner.userId,
        conversationId: conversation.id,
        userMessage: "Hello?",
        requestHeaders: authHeaders(owner.token),
      }),
    ).rejects.toThrow(UsageLimitExceededError);
  });

  it("streamConversationTurn refuses to run once the ai_tokens limit is exhausted", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    const subscription = await getSubscriptionForOrg(organization.id);
    const conversation = await createConversation({ organizationId: organization.id, userId: owner.userId });

    await recordUsage(organization.id, "ai_tokens", subscription.plan.aiTokenLimit);

    const generator = streamConversationTurn({
      organizationId: organization.id,
      userId: owner.userId,
      conversationId: conversation.id,
      userMessage: "Hello?",
      requestHeaders: authHeaders(owner.token),
    });

    await expect(generator.next()).rejects.toThrow(UsageLimitExceededError);
  });

  it("startAgentRun refuses to start once the agent_run limit is exhausted", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    const subscription = await getSubscriptionForOrg(organization.id);
    const conversation = await createConversation({ organizationId: organization.id, userId: owner.userId });

    await recordUsage(organization.id, "agent_run", subscription.plan.agentRunLimit);

    await expect(
      startAgentRun({
        organizationId: organization.id,
        userId: owner.userId,
        conversationId: conversation.id,
        goal: "Do anything at all",
        requestHeaders: authHeaders(owner.token),
      }),
    ).rejects.toThrow(UsageLimitExceededError);
  });

  it("startAgentRun refuses to start once the ai_tokens limit is exhausted, even with agent runs to spare", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    const subscription = await getSubscriptionForOrg(organization.id);
    const conversation = await createConversation({ organizationId: organization.id, userId: owner.userId });

    await recordUsage(organization.id, "ai_tokens", subscription.plan.aiTokenLimit);

    await expect(
      startAgentRun({
        organizationId: organization.id,
        userId: owner.userId,
        conversationId: conversation.id,
        goal: "Do anything at all",
        requestHeaders: authHeaders(owner.token),
      }),
    ).rejects.toThrow(UsageLimitExceededError);
  });
});
