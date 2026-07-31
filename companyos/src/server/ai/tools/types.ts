import type { z } from "zod";
import type { statement } from "@/server/auth/permissions";

export type ToolContext = {
  organizationId: string;
  userId: string;
  conversationId: string;
};

export type RequiredPermission = {
  [K in keyof typeof statement]?: (typeof statement)[K][number][];
};

export type RegisteredTool<TInput = unknown> = {
  name: string;
  description: string;
  schema: z.ZodType<TInput>;
  /** RBAC permission the caller's org membership must hold to invoke this tool. */
  requiredPermission?: RequiredPermission;
  handler: (input: TInput, ctx: ToolContext) => Promise<unknown>;
};

export type ToolExecutionResult =
  | { status: "success"; output: unknown; durationMs: number }
  | { status: "error"; error: string; durationMs: number };
