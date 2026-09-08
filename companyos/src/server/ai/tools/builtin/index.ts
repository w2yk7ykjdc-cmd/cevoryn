
/**
 * Importing this module registers every built-in tool as a side effect.
 * Import it once, early — from the AI Runtime module and from the worker
 * entrypoint — before any conversation tries to resolve tool definitions.
 */
import "@/server/ai/tools/builtin/remember-fact";
import "@/server/ai/tools/builtin/search-memory";
import "@/server/ai/tools/builtin/search-audit-log";
import "@/server/ai/tools/builtin/get-lead";
import "@/server/ai/tools/builtin/analyze-lead";
import "@/server/ai/tools/builtin/search-leads";
import "@/server/ai/tools/builtin/create-task";
import "@/server/ai/tools/builtin/record-lead-activity";
import "@/server/ai/tools/builtin/get-company-health";
import "@/server/ai/tools/builtin/get-opportunities";
import "@/server/ai/tools/builtin/get-risks";
import "@/server/ai/tools/builtin/get-next-best-action";
import "@/server/ai/tools/builtin/expire-stale-opportunity";
import "@/server/ai/tools/builtin/get-outcomes";
import "@/server/ai/tools/builtin/get-decision-performance";
import "@/server/ai/tools/builtin/rank-decision-candidates";
import "@/server/ai/tools/builtin/get-market-intelligence";
import "@/server/ai/tools/builtin/get-paper-trading";
import "@/server/ai/tools/builtin/get-strategy-performance";
