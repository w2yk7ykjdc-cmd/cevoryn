#!/usr/bin/env node
// Runs `prisma migrate deploy` during `npm run build`, but only for
// Vercel's Production deployments (VERCEL_ENV=production). Preview builds
// and local `npm run build` runs skip it, since preview deployments
// typically share the same DATABASE_URL as production and should never
// apply schema changes on their own.
//
// Without this, `prisma generate` (already in the build script) silently
// regenerates a client that references columns/tables the real database
// doesn't have yet - migrations added to prisma/migrations/ never reach
// production unless someone runs `db:migrate:deploy` by hand.
import { execSync } from "node:child_process";

if (process.env.VERCEL_ENV === "production") {
  console.log(
    "[build] VERCEL_ENV=production - running `prisma migrate deploy`"
  );
  execSync("npx prisma migrate deploy", { stdio: "inherit" });
} else {
  console.log(
    `[build] Skipping \`prisma migrate deploy\` (VERCEL_ENV=${process.env.VERCEL_ENV ?? "unset"})`
  );
}
