# Test & Quality Report

All results below were freshly run against the current `main` branch
during this documentation pass (not carried over from an earlier session).

## TypeScript

```
$ npx tsc --noEmit -p .
```
**PASS** — 0 errors.

## ESLint

```
$ npm run lint
```
**PASS** — 0 errors, 2 pre-existing warnings (both unrelated to this
documentation pass, present before this work started):
- `src/components/layout/sidebar.tsx:100` — `react-hooks/exhaustive-deps`
  (missing `visibleItems` dependency)
- `src/instrumentation.ts:15` — `no-console` (an intentional `console.log`
  not in the allowed `warn`/`error` set)

## Prettier

```
$ npm run format:check
```
**PASS** — all files conform.

## Unit tests

```
$ npm test
```
**PASS** — 179/179 tests, 0 failures, 0 skipped.

## Integration tests

Run against a real Postgres instance in CI (service container). 4
integration test files exist:
`test/integration/{cleanup,health-database,polar-webhook,rate-limit}.integration.ts`.
Not re-run in this documentation pass (would require standing up a local
Postgres instance and setting `INTEGRATION_DATABASE_URL`) — verified as
present and wired into CI instead (see below).

## Build

```
$ npm run build
```
**PASS** — production build succeeds, all 65 routes compile.

## CI (`.github/workflows/ci.yml`)

Runs automatically on every push/PR to `main`. Single job (`quality`),
against a real `postgres:16` service container:
1. `npm run db:validate` — Prisma schema validation
2. `npm run type-check`
3. `npm run lint`
4. format check (full repo on push, changed-files-only on PR)
5. `npm test`
6. `npm run test:integration` (against the real Postgres container)
7. `npm run build`

This is the same gate every PR merged during this project's development
had to pass — confirmed by this session's own PR history (each PR
required a green CI run before merge).
