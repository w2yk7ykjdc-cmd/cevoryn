# Transfer Guide

Step-by-step checklist for the buyer to take real ownership of every
system this product depends on. Ordered roughly by dependency (do earlier
steps first).

## 1. GitHub repository

Transfer (or fork + re-point Vercel to) the repository
`w2yk7ykjdc-cmd/cevoryn`. If transferring ownership directly on GitHub,
existing CI (`.github/workflows/ci.yml`) will keep working unmodified —
it has no hardcoded references to the current owner's account.

## 2. Vercel

- The Vercel project is currently under the same GitHub-linked account as
  the repository (`w2yk7ykjdc-cmd`). The buyer needs either: (a) the
  seller adds them as a project member and later removes themselves, or
  (b) a full account/project transfer via Vercel's own transfer-ownership
  flow.
- Re-point (or keep) the GitHub integration so pushes to `main` continue
  triggering deploys.
- Re-enter all environment variables under the new account/project if a
  fresh project is created instead of transferring the existing one (see
  [`ENVIRONMENT.md`](ENVIRONMENT.md)).

## 3. Domain (`cevoryn.com` / `www.cevoryn.com`)

The domain was purchased directly through **Vercel's own domain
registrar** (Project → Domains → "Buy a domain"), not a third-party
registrar like Cloudflare or Namecheap. DNS (nameservers `ns1/ns2.vercel-dns.com`)
is fully managed inside Vercel. Transferring the Vercel project/account
therefore transfers domain control with it — there is no separate
registrar account to hand over. If the buyer wants the domain moved to
their own registrar instead, that's a standard domain-transfer-out
request initiated from Vercel's Domains settings.

## 4. Supabase (database + auth)

- Supabase project ref: `pthagrzltzbdjbzavhtg` (from
  `NEXT_PUBLIC_SUPABASE_URL` / the Supabase GitHub integration's own
  linkback URL — this is not a secret, it's the public project
  identifier).
- The seller needs to either add the buyer as a project member (Supabase
  dashboard → Project Settings → Team) with Owner/Admin access, or
  transfer the organization itself if Supabase supports it for the
  account's plan tier.
- **Action for the buyer once they have access:** rotate
  `SUPABASE_SERVICE_ROLE_KEY` and the database password (Database
  Settings → "Reset database password"), then update `DATABASE_URL` /
  `DIRECT_URL` / `SUPABASE_SERVICE_ROLE_KEY` in Vercel. Treat every
  credential the previous owner had access to as compromised the moment
  ownership changes hands — this is a standard, expected step, not a sign
  of a problem with the handover.
- Supabase Auth's own user accounts (real end-users who signed up) live
  in this same Supabase project and transfer automatically with it — no
  separate migration needed.

## 5. OpenAI

- The buyer needs their own OpenAI API account and key
  (`OPENAI_API_KEY`). The existing key should not be reused post-sale —
  generate a new one under the buyer's own OpenAI organization and update
  it in Vercel.
- No OpenAI-side "transfer" mechanism is used or needed; this is just a
  key swap.

## 6. Google OAuth (Calendar + Gmail integration)

- The current Google Cloud project (internally still named "Atlas" from
  before the product's rebrand — a cosmetic/internal name only, not
  user-facing) holds the OAuth client used for `GOOGLE_CLIENT_ID` /
  `GOOGLE_CLIENT_SECRET`.
- **Recommended path:** the buyer creates their own Google Cloud project
  and OAuth 2.0 client (Web application type), configures the OAuth
  consent screen, and adds `https://<their-domain>/api/integrations/google/callback`
  as an authorized redirect URI. Update `GOOGLE_CLIENT_ID` /
  `GOOGLE_CLIENT_SECRET` in Vercel accordingly.
- **Alternative path:** transfer ownership of the existing Google Cloud
  project to the buyer's Google account (Google Cloud Console supports
  project ownership transfer) — keeps the exact same client ID, no code
  or Vercel env changes needed, but ties the buyer to the project's
  existing name/history.
- Either way, `GOOGLE_TOKEN_ENCRYPTION_KEY` should be rotated post-sale
  (this re-encrypts nothing automatically — rotating it will invalidate
  any already-stored Google refresh tokens, requiring connected users to
  reconnect Google once). Communicate this to any existing users before
  rotating.

## 7. Polar (billing)

- The buyer needs their own Polar organization, with Starter/
  Professional/Business products created matching the plan structure the
  app expects (`src/server/services/billing.service.ts` / Polar product
  IDs referenced via `POLAR_PRODUCT_*`).
- Existing subscriptions (real paying customers, if any at time of sale)
  do **not** automatically transfer between Polar organizations — this is
  a Polar-platform-level limitation, not something this codebase controls.
  Migrating active subscribers requires either a Polar-side account
  transfer (ask Polar support whether this is supported) or manually
  re-subscribing existing customers under the new organization.
- Register the new webhook endpoint and update `POLAR_WEBHOOK_SECRET` /
  `POLAR_ACCESS_TOKEN` / `POLAR_PRODUCT_*` in Vercel.

## 8. Sentry

- Optional. If the buyer wants error tracking, create a Sentry project
  and set `NEXT_PUBLIC_SENTRY_DSN`. No transfer needed if starting fresh;
  the existing Sentry project (if the buyer wants it) would need to be
  transferred at the Sentry-organization level separately.

## 9. Team invite email (Resend)

- Optional. If unset, invites still work but fall back to a copy-paste
  link instead of an actual email. To enable real invite emails, the
  buyer sets up their own Resend account/API key and `EMAIL_FROM` address
  on their own domain.

## 10. Final checklist

- [ ] GitHub repository access transferred
- [ ] Vercel project/account access transferred, all env vars re-entered or rotated
- [ ] Domain (`cevoryn.com`) ownership transferred via Vercel
- [ ] Supabase project access transferred; service-role key + DB password rotated
- [ ] New OpenAI API key issued and set
- [ ] Google Cloud OAuth client transferred or recreated; redirect URI updated; token encryption key rotated (with user-facing reconnect notice if rotating)
- [ ] Polar organization + products set up for the buyer; webhook re-registered
- [ ] (Optional) Sentry project set up
- [ ] (Optional) Resend account set up for invite emails
- [ ] Production deploy verified end-to-end (login, chat, billing checkout, Google connect) under the buyer's own credentials
