#!/usr/bin/env node
// CI-time schema-drift / destructive-migration gate. Unlike
// deploy-migrate.mjs's guard (which asks "what does the production
// database not have yet?"), this asks "what migration files does this
// branch add that its base branch doesn't have?" - the right question for
// a PR, since CI has no persistent database whose applied-migration
// history means anything.
//
// Added after the incident where an auto-generated migration silently
// dropped the live `google_connections` table - see the GoogleConnection
// model's comment in schema.prisma. This is a second, earlier layer of
// the same defense as deploy-migrate.mjs's check: this one fails the PR's
// CI run so a reviewer sees it before merge, rather than only failing the
// production deploy after merge.
//
// Run from the `atlas` working directory (matches .github/workflows/ci.yml's
// `working-directory: atlas`) - git resolves the repo root automatically
// even though it's one level up. The pathspec passed to `git diff` is
// resolved relative to this cwd, but - unlike a normal `git diff`
// invocation - the paths `--name-only` prints back are always relative to
// the repo's top level, not the cwd, so file reads below resolve against
// that top level explicitly rather than assuming either convention.
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

import { scanMigrationSql } from "./lib/destructive-migration-check.mjs";

function run(command) {
  return execSync(command, { stdio: "pipe" }).toString();
}

const REPO_TOPLEVEL = run("git rev-parse --show-toplevel").trim();

/**
 * The ref this branch is being compared against. In a PR, that's the PR's
 * base branch; on a direct push (e.g. to main), there's no "base branch"
 * to diff against, so this compares against the immediately preceding
 * commit instead - still correctly scoped to "what did this push add."
 */
function resolveBaseRef() {
  const eventName = process.env.GITHUB_EVENT_NAME;
  const baseRef = process.env.GITHUB_BASE_REF;
  if (eventName === "pull_request" && baseRef) {
    return `origin/${baseRef}`;
  }
  return "HEAD^";
}

function listNewlyAddedMigrationFiles(baseRef) {
  const output = run(
    `git diff --name-only --diff-filter=A "${baseRef}...HEAD" -- prisma/migrations`
  );
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.endsWith("/migration.sql"));
}

function main() {
  const baseRef = resolveBaseRef();
  let newMigrationFiles;
  try {
    newMigrationFiles = listNewlyAddedMigrationFiles(baseRef);
  } catch (error) {
    // No merge-base with the base ref (e.g. a shallow checkout, or the
    // very first commit) - fail open rather than block CI on a git
    // plumbing error unrelated to migration content. deploy-migrate.mjs's
    // deploy-time check still runs regardless as the final backstop.
    console.warn(
      `[ci] Could not diff against ${baseRef} (${error.message.split("\n")[0]}) - skipping the migration-diff check for this run.`
    );
    return;
  }

  if (newMigrationFiles.length === 0) {
    console.log("[ci] No new migrations on this branch - nothing to check.");
    return;
  }

  const blocked = [];
  for (const repoRelativePath of newMigrationFiles) {
    const rawSql = readFileSync(
      path.join(REPO_TOPLEVEL, repoRelativePath),
      "utf8"
    );
    const statements = scanMigrationSql(rawSql);
    if (statements.length > 0) {
      blocked.push({ path: repoRelativePath, statements });
    }
  }

  console.log(
    `[ci] Scanned ${newMigrationFiles.length} new migration(s) against ${baseRef}.`
  );

  if (blocked.length === 0) {
    console.log("[ci] Destructive-migration check passed.");
    return;
  }

  console.error(
    "\n[ci] BLOCKED: this branch adds migration(s) containing destructive SQL that has not been explicitly reviewed.\n"
  );
  for (const { path: migrationPath, statements } of blocked) {
    console.error(`  - ${migrationPath}: ${statements.join(", ")}`);
  }
  console.error(
    "\nIf this is genuinely intentional (e.g. dropping a table confirmed to have\n" +
      "no readers/data worth keeping), add this exact line to that migration's\n" +
      "migration.sql to acknowledge it - a reviewer should treat that line as a\n" +
      "request to specifically verify the drop is safe, not a rubber stamp:\n\n  -- cevoryn:allow-destructive\n\n" +
      "Otherwise, rewrite the migration to be additive/non-destructive (see the\n" +
      "GoogleConnection model's comment in prisma/schema.prisma for the incident\n" +
      "this check exists to prevent).\n"
  );
  process.exit(1);
}

main();
