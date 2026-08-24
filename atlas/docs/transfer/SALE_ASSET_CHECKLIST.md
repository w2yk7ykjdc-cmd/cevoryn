# Sale Asset Checklist

| Asset | Present? | Location / notes |
|---|---|---|
| Source code | ✅ | GitHub `w2yk7ykjdc-cmd/cevoryn` (private repo), `atlas/` subdirectory |
| Git history | ✅ | Full, non-squashed commit history on `main` (this is a continuously-developed repo, not a single-commit snapshot) |
| Database schema | ✅ | `prisma/schema.prisma` — 19 models |
| Migrations | ✅ | `prisma/migrations/`, applied automatically on production deploy (see `DEPLOYMENT_GUIDE.md`) |
| Documentation | ✅ | This `docs/transfer/` set, plus `README.md`, `docs/beta-readiness.md`, `docs/google-integration.md` |
| Deployment configuration | ✅ | `vercel.json` (cron jobs), `next.config.ts` (redirects, security headers, CSP), `.github/workflows/ci.yml` |
| Brand/domain assets | ✅ | `cevoryn.com`/`www.cevoryn.com` (Vercel-managed), logo/favicon/OG image in `public/` and `src/lib/brand.ts` |
| Billing integration | ✅ (code) | Polar.sh integration code is complete and production-tested; the Polar **organization/account** itself does not transfer automatically — see `TRANSFER_GUIDE.md` §7 |
| AI integration | ✅ (code) | OpenAI integration code complete; API key must be re-provisioned by buyer |
| Third-party integrations | ✅ (code) | Google Calendar/Gmail (OAuth) code complete; Sentry and Resend integrations complete and optional |
| Real production database contents | ✅ | Transfers with the Supabase project handover |
| Automated test suite | ✅ | 179 unit tests + 4 integration test files, CI-gated |
| CI/CD pipeline | ✅ | GitHub Actions, portable to a new repo owner without modification |

## Explicitly not included / not applicable

- No separate design files (Figma etc.) found in the repository — UI is
  implemented directly in code (Tailwind + shadcn/ui), there is no
  separate design-source asset to hand over beyond the code itself.
- No formal user/API documentation beyond this technical transfer set and
  in-app UI copy.
- No trademark/patent filings referenced anywhere in the repository.
