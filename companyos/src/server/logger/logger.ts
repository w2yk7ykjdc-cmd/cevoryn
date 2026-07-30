import pino from "pino";
import { env } from "@/env";

/**
 * Root structured logger. Every log line is JSON with at least
 * { level, time, msg } plus whatever bindings the caller attaches, so logs
 * can be shipped straight into a log aggregator (Datadog, Axiom, CloudWatch)
 * without a parsing layer. Use `.child({...})` to attach request-scoped
 * context (tenantId, userId, requestId) — never `console.log`.
 */
export const logger = pino({
  level: env.LOG_LEVEL,
  base: {
    service: "companyos",
    env: env.NODE_ENV,
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: {
    paths: [
      "*.password",
      "*.token",
      "*.secret",
      "*.apiKey",
      "*.authorization",
      "req.headers.authorization",
      "req.headers.cookie",
    ],
    censor: "[REDACTED]",
  },
  transport:
    env.NODE_ENV === "development"
      ? {
          target: "pino-pretty",
          options: { colorize: true, translateTime: "HH:MM:ss.l", ignore: "pid,hostname" },
        }
      : undefined,
});

export type RequestLogContext = {
  requestId: string;
  organizationId?: string;
  userId?: string;
  route?: string;
};

/** Creates a request-scoped child logger carrying tenant/user/request ids. */
export function createRequestLogger(context: RequestLogContext) {
  return logger.child(context);
}
