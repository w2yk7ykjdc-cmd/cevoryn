export type ToolRiskLevel = "auto" | "requires_approval";

/**
 * Tools the agent may run without a human approval gate: strictly read-only
 * lookups (`get_lead`, `search_leads`, `search_audit_log`, `search_memory`),
 * a deterministic analysis (`analyze_lead`), and append-only annotations
 * (`record_lead_activity`, `remember_fact`) that add information without
 * creating actionable work or reaching outside the conversation.
 *
 * Every other tool — including `create_task`, which assigns real work to a
 * person and can trigger reminder notifications, and any tool a future
 * sprint registers without updating this list — requires approval. Unknown
 * tools default to `requires_approval`: this policy fails closed.
 */
const AUTO_TOOLS = new Set([
  "get_lead",
  "analyze_lead",
  "search_leads",
  "search_audit_log",
  "search_memory",
  "remember_fact",
  "record_lead_activity",
]);

export function classifyToolRisk(toolName: string): ToolRiskLevel {
  return AUTO_TOOLS.has(toolName) ? "auto" : "requires_approval";
}
