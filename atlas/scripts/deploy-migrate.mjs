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
//
// Production's schema predates this script: it was built up without
// Prisma Migrate ever tracking which migrations were applied, so a plain
// `migrate deploy` fails (P3005/P3009/P3018 - "schema is not empty" / "a
// migration failed" family) because Prisma tries to re-run migrations
// whose SQL the live schema already reflects. The fallback below
// baselines each pre-existing migration as applied (verified locally: it
// only writes to Prisma's own `_prisma_migrations` bookkeeping table via
// `migrate resolve --applied`, never touches application data) and then
// retries. It's idempotent - `migrate resolve --applied` on an
// already-applied migration is a harmless no-op (P3008) - so this is
// permanently safe to leave in for repeat builds.
import { execSync } from "node:child_process";

function run(command) {
  return execSync(command, { stdio: "pipe" }).toString();
}

function errorOutput(error) {
  return (error.stdout?.toString() ?? "") + (error.stderr?.toString() ?? "");
}

// Migrations that were already reflected in the production schema before
// `prisma migrate deploy` was ever run there for the first time.
const PRE_EXISTING_MIGRATIONS = [
  "20250101000000_initial",
  "20260724150000_add_google_connections",
  "20260725233000_add_billing_subscriptions",
  "20260726161000_add_paddle_billing_provider",
  "20260731220000_add_analytics_events",
  "20260811080000_add_auth_rate_limit_attempts",
  "20260812120000_add_polar_billing_provider",
];

function baselinePreExistingMigrations() {
  for (const name of PRE_EXISTING_MIGRATIONS) {
    try {
      run(`npx prisma migrate resolve --applied ${name}`);
      console.log(`[build] Baselined: ${name}`);
    } catch (error) {
      const output = errorOutput(error);
      if (output.includes("already recorded as applied")) {
        console.log(`[build] Already baselined: ${name}`);
        continue;
      }
      console.error(output);
      throw error;
    }
  }
}

if (process.env.VERCEL_ENV === "production") {
  console.log(
    "[build] VERCEL_ENV=production - running `prisma migrate deploy`"
  );
  try {
    console.log(run("npx prisma migrate deploy"));
  } catch (error) {
    const output = errorOutput(error);
    const blockedByUntrackedHistory =
      output.includes("P3005") ||
      output.includes("P3009") ||
      output.includes("P3018");

    if (!blockedByUntrackedHistory) {
      console.error(output);
      throw error;
    }

    console.log(
      "[build] `prisma migrate deploy` is blocked by untracked migration history - baselining pre-existing migrations as applied, then retrying."
    );
    baselinePreExistingMigrations();
    console.log(run("npx prisma migrate deploy"));
  }
} else {
  console.log(
    `[build] Skipping \`prisma migrate deploy\` (VERCEL_ENV=${process.env.VERCEL_ENV ?? "unset"})`
  );
}
