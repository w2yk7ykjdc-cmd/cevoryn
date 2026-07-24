# Google integration setup

Required environment variables:

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_TOKEN_ENCRYPTION_KEY` (random, at least 32 characters)
- `NEXT_PUBLIC_APP_URL`

Google Cloud OAuth redirect URI:

`<NEXT_PUBLIC_APP_URL>/api/integrations/google/callback`

Requested scopes:

- OpenID email identity
- Gmail read-only
- Gmail compose
- Google Calendar read-only
- Google Calendar events

Database notes:

- Apply `prisma/migrations/20260724150000_add_google_connections/migration.sql` before testing the OAuth callback.
- The integration currently accesses `google_connections` through parameterized raw SQL.
- Do not mark the integration ready until the migration exists in the target database and the callback can insert or update a connection successfully.

Before merging:

1. Run the new database migration.
2. Add the environment variables to the preview deployment.
3. Verify that the Google Cloud redirect URI exactly matches the preview or production application URL.
4. Verify connect, callback, status, and disconnect flows.
5. Confirm the Settings page still loads when no connection exists.
6. Create a Gmail draft and Calendar event with explicit user approval.
