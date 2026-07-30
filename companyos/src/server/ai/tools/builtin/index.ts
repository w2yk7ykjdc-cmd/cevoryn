
/**
 * Importing this module registers every built-in tool as a side effect.
 * Import it once, early — from the AI Runtime module and from the worker
 * entrypoint — before any conversation tries to resolve tool definitions.
 */
import "@/server/ai/tools/builtin/remember-fact";
import "@/server/ai/tools/builtin/search-memory";
import "@/server/ai/tools/builtin/search-audit-log";
