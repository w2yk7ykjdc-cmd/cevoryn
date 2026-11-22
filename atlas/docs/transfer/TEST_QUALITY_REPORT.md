# Test & Quality Report

## Current verification status

**CI-verified**, commit `f2218d2bd6c4e0526d1f0790cdd58c51a7be465b` on
`sale/cevoryn-sale-readiness-fixes` (PR #310, based on
`sale/cevoryn-without-romance`). Two independent GitHub Actions `quality`
job runs against this exact commit both completed successfully:
- [run 45049873084](https://github.com/w2yk7ykjdc-cmd/cevoryn/actions/runs/45049873084) (push trigger)
- [run 45049878103](https://github.com/w2yk7ykjdc-cmd/cevoryn/actions/runs/45049878103) (pull_request trigger)

| Gate | Result | Evidence |
|---|---|---|
| Prisma schema validation | PASS | "The schema at prisma/schema.prisma is valid" |
| Destructive migration check | PASS | "No new migrations on this branch - nothing to check." |
| TypeScript | PASS | step completed with no errors |
| ESLint | PASS | "2 problems (0 errors, 2 warnings)" — the 2 warnings are pre-existing and unrelated to this branch |
| Prettier (changed files) | PASS | ran clean on both triggers |
| Unit tests | **PASS — 307/307, 0 failed** | identical count on both runs |
| Integration tests (real Postgres 16) | **PASS — 126/126, 0 failed** | identical count on both runs |
| Production build | PASS | succeeds, 0 `/romance` routes present |
| Playwright browser E2E | **PASS — 3/3** | 13.7s (push run) / 20.3s (pull_request run) |

This is not a production-readiness or buyer-acceptance claim — it is
CI passing on this exact commit, nothing more. No live third-party
integration (Polar, Google, OpenAI) was exercised: CI runs against
placeholder env values.

The historical results below predate this verification and are kept
only as background; they are not current evidence.

## Historical snapshot (not current)

An earlier report recorded:
- TypeScript: pass
- ESLint: pass with 2 warnings
- Prettier: pass
- Unit tests: 179/179
- Production build: pass, 65 routes
- Integration tests: wired into CI but not re-run in that report

A separate valuation report dated 2026-10-12 recorded 307/307 unit tests
and an 81-route build for a prior sale snapshot. These counts conflict
with the earlier 179-test report and have not been reproduced against
the current branch. Neither count should be used in buyer-facing
materials as a current result.

## CI configuration

The sale-readiness branch configures the quality workflow to run on
pushes and pull requests for the sale branch and `main`. The workflow
contains these gates:

1. Prisma schema validation
2. Destructive migration check
3. TypeScript type-check
4. ESLint
5. Prettier check for changed source files
6. Unit tests
7. Integration tests against PostgreSQL 16
8. Production build
9. Playwright Chromium browser smoke tests

Configuration is not execution evidence. The GitHub Actions run must
complete successfully on the exact candidate commit before the product
is described as passing CI.

## Required release evidence

Before publishing buyer-facing quality claims, record the exact commit
SHA and successful run URLs for:
- TypeScript
- Lint and formatting
- Unit tests (actual count from the run)
- PostgreSQL integration tests
- Production build
- Playwright browser smoke tests

If any gate fails or is skipped, disclose it here. Do not replace a
failed or unavailable check with a historical count.
