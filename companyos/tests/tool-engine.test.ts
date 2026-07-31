import { afterAll, describe, expect, it } from "vitest";
import "@/server/ai/tools/builtin"; // registers search_audit_log, remember_fact, search_memory
import { executeToolCall } from "@/server/ai/tools/executor";
import { createConversation } from "@/server/ai/runtime/conversations";
import { recordAuditLog } from "@/server/audit/audit-log";
import { prisma } from "@/server/db/client";
import {
  addMemberDirect,
  authHeaders,
  closeTestConnections,
  createOrgForUser,
  signUpUser,
} from "./helpers";

describe("Tool Engine", () => {
  afterAll(closeTestConnections);

  async function setup(role: "owner" | "member" = "owner") {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);

    let caller = owner;
    if (role === "member") {
      caller = await signUpUser();
      await addMemberDirect(organization.id, caller, "member");
    }

    const conversation = await createConversation({
      organizationId: organization.id,
      userId: caller.userId,
    });

    await recordAuditLog({
      organizationId: organization.id,
      actorId: owner.userId,
      actorType: "user",
      action: "test.seed_entry",
      targetType: "organization",
      targetId: organization.id,
    });

    return { owner, organization, conversation, caller };
  }

  it("executes a tool successfully when the caller holds the required permission", async () => {
    const { organization, conversation, caller } = await setup("owner");

    const result = await executeToolCall(
      { id: "call-1", name: "search_audit_log", arguments: { limit: 5 } },
      { organizationId: organization.id, userId: caller.userId, conversationId: conversation.id },
      authHeaders(caller.token),
    );

    expect(result.status).toBe("success");
    if (result.status === "success") {
      const output = result.output as { entries: { action: string }[] };
      expect(output.entries.some((e) => e.action === "test.seed_entry")).toBe(true);
    }
  });

  it("denies execution when the caller's role lacks the required permission", async () => {
    const { organization, conversation, caller } = await setup("member");

    const result = await executeToolCall(
      { id: "call-2", name: "search_audit_log", arguments: { limit: 5 } },
      { organizationId: organization.id, userId: caller.userId, conversationId: conversation.id },
      authHeaders(caller.token),
    );

    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.error).toMatch(/permission/i);
    }
  });

  it("rejects unknown tools without touching any handler", async () => {
    const { organization, conversation, caller } = await setup("owner");

    const result = await executeToolCall(
      { id: "call-3", name: "delete_the_database", arguments: {} },
      { organizationId: organization.id, userId: caller.userId, conversationId: conversation.id },
      authHeaders(caller.token),
    );

    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.error).toMatch(/unknown tool/i);
    }
  });

  it("rejects arguments that fail the tool's schema", async () => {
    const { organization, conversation, caller } = await setup("owner");

    const result = await executeToolCall(
      { id: "call-4", name: "search_audit_log", arguments: { limit: "not-a-number" } },
      { organizationId: organization.id, userId: caller.userId, conversationId: conversation.id },
      authHeaders(caller.token),
    );

    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.error).toMatch(/invalid arguments/i);
    }
  });

  it("logs every invocation (success or failure) to ToolInvocation and the event bus", async () => {
    const { organization, conversation, caller } = await setup("owner");

    await executeToolCall(
      { id: "call-5", name: "search_audit_log", arguments: { limit: 1 } },
      { organizationId: organization.id, userId: caller.userId, conversationId: conversation.id },
      authHeaders(caller.token),
    );

    const invocation = await prisma.toolInvocation.findFirst({
      where: { conversationId: conversation.id, toolName: "search_audit_log" },
      orderBy: { createdAt: "desc" },
    });
    expect(invocation?.status).toBe("success");

    const event = await prisma.domainEvent.findFirst({
      where: { organizationId: organization.id, type: "ai.tool.invoked" },
      orderBy: { createdAt: "desc" },
    });
    expect(event).not.toBeNull();
  });
});
