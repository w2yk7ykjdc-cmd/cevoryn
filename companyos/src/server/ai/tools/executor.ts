import type { Prisma } from "@prisma/client";
import type { ToolCall } from "@/server/ai/providers/types";
import type { ToolContext, ToolExecutionResult } from "@/server/ai/tools/types";
import { getTool } from "@/server/ai/tools/registry";
import { auth } from "@/server/auth/auth";
import { prisma } from "@/server/db/client";
import { publishEvent } from "@/server/events/event-bus";
import { logger } from "@/server/logger/logger";

/**
 * Executes a single tool call requested by a model, enforcing (in order):
 * 1. The tool exists.
 * 2. The caller's organization membership holds `requiredPermission`, if any.
 * 3. The arguments the model produced validate against the tool's Zod schema.
 *
 * Every invocation — success or failure — is persisted to `ToolInvocation`
 * for auditability and published on the event bus. A failing tool never
 * throws out of this function; the AI Runtime feeds the error back to the
 * model as a tool result so it can recover or explain the failure to the user.
 */
export async function executeToolCall(
  call: ToolCall,
  ctx: ToolContext,
  requestHeaders: Headers,
): Promise<ToolExecutionResult> {
  const startedAt = Date.now();
  const tool = getTool(call.name);

  if (!tool) {
    return finalize(ctx, call, { status: "error", error: `Unknown tool "${call.name}"`, durationMs: Date.now() - startedAt });
  }

  if (tool.requiredPermission) {
    const permitted = await auth.api.hasPermission({
      headers: requestHeaders,
      body: {
        organizationId: ctx.organizationId,
        permissions: tool.requiredPermission as Record<string, string[]>,
      },
    });
    if (!permitted.success) {
      return finalize(ctx, call, {
        status: "error",
        error: `Missing permission to execute tool "${call.name}"`,
        durationMs: Date.now() - startedAt,
      });
    }
  }

  const parsed = tool.schema.safeParse(call.arguments);
  if (!parsed.success) {
    return finalize(ctx, call, {
      status: "error",
      error: `Invalid arguments: ${parsed.error.message}`,
      durationMs: Date.now() - startedAt,
    });
  }

  try {
    const output = await tool.handler(parsed.data, ctx);
    return finalize(ctx, call, { status: "success", output, durationMs: Date.now() - startedAt });
  } catch (err) {
    logger.error({ err, tool: call.name, ctx }, "tool handler threw");
    return finalize(ctx, call, {
      status: "error",
      error: err instanceof Error ? err.message : "Tool execution failed",
      durationMs: Date.now() - startedAt,
    });
  }
}

async function finalize(
  ctx: ToolContext,
  call: ToolCall,
  result: ToolExecutionResult,
): Promise<ToolExecutionResult> {
  await prisma.toolInvocation.create({
    data: {
      conversationId: ctx.conversationId,
      toolName: call.name,
      input: call.arguments as Prisma.InputJsonValue,
      output: result.status === "success" ? (result.output as Prisma.InputJsonValue) : undefined,
      status: result.status,
      errorMessage: result.status === "error" ? result.error : null,
      durationMs: result.durationMs,
    },
  });

  await publishEvent(
    "ai.tool.invoked",
    {
      organizationId: ctx.organizationId,
      conversationId: ctx.conversationId,
      toolName: call.name,
      status: result.status,
      durationMs: result.durationMs,
    },
    { organizationId: ctx.organizationId },
  );

  return result;
}
