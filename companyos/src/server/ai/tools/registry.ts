import { z } from "zod";
import type { ToolDefinition } from "@/server/ai/providers/types";
import type { RegisteredTool } from "@/server/ai/tools/types";

const tools = new Map<string, RegisteredTool>();

/** Registers a tool. Call this once per tool at module init (see `builtin/index.ts`). */
export function registerTool<TInput>(tool: RegisteredTool<TInput>): void {
  if (tools.has(tool.name)) {
    throw new Error(`Tool "${tool.name}" is already registered`);
  }
  tools.set(tool.name, tool as RegisteredTool);
}

export function getTool(name: string): RegisteredTool | undefined {
  return tools.get(name);
}

/** JSON-Schema tool definitions for the AI Runtime to hand to the provider. */
export function listToolDefinitions(): ToolDefinition[] {
  return Array.from(tools.values()).map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: z.toJSONSchema(tool.schema, { target: "draft-7" }) as Record<string, unknown>,
  }));
}

export function listRegisteredTools(): RegisteredTool[] {
  return Array.from(tools.values());
}
