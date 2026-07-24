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
- Gmail compose
- Google Calendar events

Before merging:

1. Run the new database migration.
2. Add the environment variables to the preview deployment.
3. Verify connect, callback, status, and disconnect flows.
4. Confirm the Settings page still loads when no connection exists.
