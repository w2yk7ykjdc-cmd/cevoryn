# Test & Quality Report

## Current verification status

**NOT RUN in this review.** No current test result is claimed for
`sale/cevoryn-without-romance` or this readiness-fixes branch.

The historical results below were present in earlier repository
documentation. They are not evidence that the current branch passes.

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
