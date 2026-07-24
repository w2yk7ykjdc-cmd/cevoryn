# Atlas Private Beta Readiness

## Current branch

`beta-hardening`

## Build status

The branch must be considered beta-ready only when the latest Vercel Preview deployment succeeds.

## Code-complete reliability work

- Authentication redirects preserve safe `next` paths.
- Password-reset request, callback, reset form, session validation, password update, sign-out, and success redirect are connected.
- Chat has loading, error, empty/new-chat, and not-found states.
- Dashboard has loading, error, and not-found states.
- Conversation rename and archive APIs are tenant- and owner-scoped.
- Conversation rename and archive controls are connected to the chat UI.
- Team invite creation is rate-limited.
- Invite acceptance is atomic and single-use.
- Invite renewal rotates tokens and invalidates old links.
- Expired invitations are excluded from active lists.
- Member role changes and removals are organization-scoped and race-resistant.
- Critical chat and team APIs use the shared safe API error format.

## Confirmed manual checks

- Preview application opens.
- Sign-in succeeds.
- Chat returns an AI response.
- A new conversation can be created.

## Final manual acceptance checks

These require a real browser, email delivery, and authenticated user interaction:

1. Rename a conversation and refresh the page.
2. Archive a conversation and confirm it disappears from the active list.
3. Request a password-reset email, open the link, set a new password, and sign in with it.
4. Create, renew, and revoke a team invitation.
5. Accept an invitation with a separate test account.
6. Verify mobile chat input remains visible above the keyboard.

## Release boundary

Passing the final checks makes Atlas suitable for a small, controlled private beta. It does not yet certify enterprise readiness, formal penetration testing, legal compliance, or large-scale production usage.
