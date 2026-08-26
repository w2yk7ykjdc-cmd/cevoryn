import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/server/db/client";
import { appendMessage } from "@/server/ai/memory/short-term";
import {
  archiveConversation,
  ConversationNotFoundError,
  createConversation,
  getConversationMessages,
  listConversations,
} from "@/server/ai/runtime/conversations";
import { closeTestConnections, createOrgForUser, signUpUser } from "./helpers";

describe("conversation history", () => {
  afterAll(closeTestConnections);

  it("listConversations falls back to a snippet of the first user message when no title was set", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    const conversation = await createConversation({ organizationId: organization.id, userId: owner.userId });
    await appendMessage({ conversationId: conversation.id, role: "user", content: "What's our pipeline value?" });
    await appendMessage({ conversationId: conversation.id, role: "assistant", content: "It's $42,000." });

    const [summary] = await listConversations(organization.id, owner.userId);
    expect(summary?.title).toBe("What's our pipeline value?");
  });

  it("listConversations uses the explicit title when one was set (e.g. by an agent run)", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    await createConversation({ organizationId: organization.id, userId: owner.userId, title: "Follow up on Acme" });

    const [summary] = await listConversations(organization.id, owner.userId);
    expect(summary?.title).toBe("Follow up on Acme");
  });

  it("listConversations orders by updatedAt descending and excludes archived conversations", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    const first = await createConversation({ organizationId: organization.id, userId: owner.userId, title: "First" });
    const second = await createConversation({ organizationId: organization.id, userId: owner.userId, title: "Second" });
    // Force a distinct, later `updatedAt` on `first` so ordering isn't a race on identical millisecond timestamps.
    await prisma.conversation.update({ where: { id: first.id }, data: { updatedAt: new Date(Date.now() + 1000) } });

    const before = await listConversations(organization.id, owner.userId);
    expect(before.map((c) => c.title)).toEqual(["First", "Second"]);

    await archiveConversation(organization.id, second.id, owner.userId);
    const after = await listConversations(organization.id, owner.userId);
    expect(after.map((c) => c.title)).toEqual(["First"]);
  });

  it("getConversationMessages returns only user/assistant messages in order, excluding system/tool rows", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    const conversation = await createConversation({ organizationId: organization.id, userId: owner.userId });
    await appendMessage({ conversationId: conversation.id, role: "system", content: "system prompt" });
    await appendMessage({ conversationId: conversation.id, role: "user", content: "Hello" });
    await appendMessage({ conversationId: conversation.id, role: "assistant", content: "Hi there" });
    await appendMessage({ conversationId: conversation.id, role: "tool", content: "{}", toolCallId: "t1", toolName: "get_lead" });

    const messages = await getConversationMessages(organization.id, conversation.id);
    expect(messages.map((m) => ({ role: m.role, content: m.content }))).toEqual([
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Hi there" },
    ]);
  });

  it("getConversationMessages rejects a conversation from another organization", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    const otherOwner = await signUpUser();
    const otherOrg = await createOrgForUser(otherOwner);
    const conversation = await createConversation({ organizationId: otherOrg.id, userId: otherOwner.userId });

    await expect(getConversationMessages(organization.id, conversation.id)).rejects.toThrow(
      ConversationNotFoundError,
    );
  });

  it("archiveConversation sets archivedAt and records an audit log entry", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    const conversation = await createConversation({ organizationId: organization.id, userId: owner.userId, title: "To delete" });

    await archiveConversation(organization.id, conversation.id, owner.userId);

    const updated = await prisma.conversation.findUniqueOrThrow({ where: { id: conversation.id } });
    expect(updated.archivedAt).not.toBeNull();

    const auditEntry = await prisma.auditLog.findFirst({
      where: { organizationId: organization.id, action: "conversation.archived", targetId: conversation.id },
    });
    expect(auditEntry?.actorId).toBe(owner.userId);
  });

  it("archiveConversation rejects an already-archived conversation and one from another organization", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    const conversation = await createConversation({ organizationId: organization.id, userId: owner.userId });
    await archiveConversation(organization.id, conversation.id, owner.userId);

    await expect(archiveConversation(organization.id, conversation.id, owner.userId)).rejects.toThrow(
      ConversationNotFoundError,
    );

    const otherOwner = await signUpUser();
    const otherOrg = await createOrgForUser(otherOwner);
    const otherConversation = await createConversation({ organizationId: otherOrg.id, userId: otherOwner.userId });
    await expect(archiveConversation(organization.id, otherConversation.id, owner.userId)).rejects.toThrow(
      ConversationNotFoundError,
    );
  });
});
