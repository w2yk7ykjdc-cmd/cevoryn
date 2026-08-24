# Deployment Guide

## Current production setup

Production deploys automatically from the `main` branch via Vercel's
GitHub integration — every push to `main` (normally via a merged PR)
triggers a new production build and deploy. No manual deploy step exists
or is needed for the day-to-day flow.

## Database migrations — already automated, read this before touching it

`npm run build` runs `prisma generate && node scripts/deploy-migrate.mjs
&& next build`. `scripts/deploy-migrate.mjs`:

- Runs `prisma migrate deploy` **only** when `VERCEL_ENV=production`
  (local builds and Vercel preview builds skip it entirely, since preview
  deployments share the same database and must never apply schema changes
  on their own).
- Production's schema pre-dates Prisma Migrate ever tracking applied
  migrations, so a plain `migrate deploy` would fail. The script
  self-heals by baselining a known list of pre-existing migrations as
  already-applied (via `prisma migrate resolve --applied`, which only
  writes to Prisma's own bookkeeping table, never touches application
  data) before retrying. This is idempotent and safe to leave in for
  every future build.

**Practical effect for a new owner:** you do not need to run migrations
by hand after a normal deploy. If you add a new migration
(`prisma/migrations/`), it will be applied automatically the next time
`main` deploys to production. `db:migrate:deploy` (`prisma migrate
deploy`) remains available for manual use if ever needed outside a
Vercel build.

## Clean deployment procedure (for a fresh environment, or to verify the current one)

1. **Provision the database.** A Supabase Postgres project (or any
   Postgres 16-compatible instance) works; the app was built and tested
   against Supabase specifically (Supabase Auth is used for
   authentication, not just the database).
2. **Set all required environment variables** in Vercel's Project
   Settings → Environment Variables (Production + Preview as
   appropriate). See [`ENVIRONMENT.md`](ENVIRONMENT.md) for the full list.
3. **Connect the GitHub repository to a Vercel project**, with
   `atlas/` as the project root directory (this is a monorepo-style
   layout — the Next.js app lives under `atlas/`, not the repo root).
4. **Trigger a production deploy** (push to `main`, or Vercel's "Redeploy"
   action). The build pipeline runs Prisma generate → migrate deploy
   (production only) → `next build` automatically.
5. **Verify the deploy**: check Vercel's "Deployments" tab for a
   successful Production deployment (not just that CI passed — CI and the
   actual Vercel deploy are separate systems). Then hit
   `https://<your-domain>/api/health` and confirm a 200 response.
6. **Configure the custom domain** in Vercel's Domains settings if not
   already done (`cevoryn.com` / `www.cevoryn.com` are currently
   registered and managed directly through Vercel's own domain
   registrar — see `TRANSFER_GUIDE.md` for details).
7. **Configure the Polar webhook endpoint** (`https://<your-domain>/api/billing/polar/webhook`)
   in the Polar dashboard, and confirm `POLAR_WEBHOOK_SECRET` in Vercel
   matches what Polar issued for that endpoint.
8. **Configure the Google OAuth redirect URI** (`https://<your-domain>/api/integrations/google/callback`)
   as an authorized redirect URI in the Google Cloud Console OAuth client
   used for `GOOGLE_CLIENT_ID`.
9. **Set up Vercel Cron** — `vercel.json` already declares 2 daily cron
   jobs (`cleanup-usage-reservations`, `cleanup-billing-hardening-records`);
   these activate automatically on deploy as long as `CRON_SECRET` is set
   and the project is on a Vercel plan that supports the declared cron
   count/frequency (2 jobs, once/day each — fits the Hobby plan's limit
   exactly, with no headroom for a third job or a more frequent schedule
   without upgrading).

## Rollback

Vercel keeps every previous production deployment and supports one-click
"Instant Rollback" to any prior deployment from the Deployments tab. This
does **not** roll back database migrations — a rollback that needs a
schema rollback as well requires a manual `prisma migrate` intervention
(not automated in this codebase).
