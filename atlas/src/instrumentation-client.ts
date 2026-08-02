import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  // NODE_ENV is "production" for every `next build`, including Vercel preview
  // deployments — NEXT_PUBLIC_VERCEL_ENV ("production" | "preview" |
  // "development") is what actually distinguishes them.
  environment: process.env.NEXT_PUBLIC_VERCEL_ENV ?? process.env.NODE_ENV,
  tracesSampleRate: 0.1,
});
