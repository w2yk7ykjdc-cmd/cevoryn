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
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  ALLOW_DESTRUCTIVE_MARKER,
  scanMigrationSql,
} from "./lib/destructive-migration-check.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, "..", "prisma", "migrations");

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

/**
 * Destructive-migration fail-safe (added after the incident where an
 * auto-generated migration silently dropped the live `google_connections`
 * table - see the GoogleConnection model's comment in schema.prisma).
 *
 * Before running any SQL against production, this scans every migration
 * that has not yet been recorded as applied for statements that discard
 * data outright (DROP TABLE/COLUMN/DATABASE/SCHEMA, TRUNCATE). Comments
 * are stripped first so a mention of these words in an explanatory
 * comment (like this file's own migration.sql headers) never triggers a
 * false positive - only literal SQL statements do.
 *
 * This is a deliberate-override gate, not an unconditional block: a
 * migration that genuinely needs to drop something can proceed by adding
 * a `-- cevoryn:allow-destructive` comment line to its migration.sql,
 * which is itself a durable, git-reviewable record of "yes, this was
 * intentional" (unlike an environment variable, which is invisible in the
 * diff a reviewer actually looks at).
 */
function listAllMigrationNames() {
  return readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

/**
 * Already-applied migration names, read directly via the generated Prisma
 * Client (available since `prisma generate` already ran earlier in `npm
 * run build`) rather than shelling out to the CLI, whose plain-text output
 * isn't a stable contract to parse. If `_prisma_migrations` doesn't exist
 * yet (a brand-new database), every migration is treated as pending -
 * the conservative direction, since scanning a migration that turns out
 * to already be applied costs nothing, while skipping one that is
 * genuinely about to run for the first time is the failure mode this
 * guard exists to prevent.
 */
async function getAppliedMigrationNames() {
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();
  try {
    const rows = await prisma.$queryRaw`
      SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL
    `;
    return new Set(rows.map((row) => row.migration_name));
  } catch {
    return new Set();
  } finally {
    await prisma.$disconnect();
  }
}

async function assertNoUnreviewedDestructiveMigrations() {
  const applied = await getAppliedMigrationNames();
  const pending = listAllMigrationNames().filter((name) => !applied.has(name));

  const blocked = [];
  for (const name of pending) {
    const sqlPath = path.join(MIGRATIONS_DIR, name, "migration.sql");
    let rawSql;
    try {
      rawSql = readFileSync(sqlPath, "utf8");
    } catch {
      continue;
    }

    const statements = scanMigrationSql(rawSql);
    if (statements.length > 0) {
      blocked.push({ name, statements });
    }
  }

  if (blocked.length === 0) {
    console.log(
      `[build] Destructive-migration check passed (${pending.length} pending migration(s) scanned).`
    );
    return;
  }

  console.error(
    "\n[build] BLOCKED: pending migration(s) contain destructive SQL that has not been explicitly reviewed.\n"
  );
  for (const { name, statements } of blocked) {
    console.error(`  - ${name}: ${statements.join(", ")}`);
  }
  console.error(
    "\nIf this is genuinely intentional (e.g. dropping a table confirmed to have\n" +
      "no readers/data worth keeping), add this exact line to that migration's\n" +
      `migration.sql to acknowledge it and unblock the deploy:\n\n  -- ${ALLOW_DESTRUCTIVE_MARKER}\n\n` +
      "Otherwise, rewrite the migration to be additive/non-destructive (see the\n" +
      "GoogleConnection model's comment in schema.prisma for the incident this\n" +
      "check exists to prevent) and never edit an already-applied migration file\n" +
      "in place.\n"
  );
  process.exit(1);
}

if (process.env.VERCEL_ENV === "production") {
  console.log(
    "[build] VERCEL_ENV=production - running `prisma migrate deploy`"
  );
  await assertNoUnreviewedDestructiveMigrations();
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
