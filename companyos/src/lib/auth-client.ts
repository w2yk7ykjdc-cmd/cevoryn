"use client";

import { createAuthClient } from "better-auth/react";
import { organizationClient, adminClient } from "better-auth/client/plugins";
import { env } from "@/env";

/**
 * Browser-side Better Auth client. Provides `useSession`, `signIn`,
 * `signUp`, `signOut`, and the organization/admin action hooks used
 * throughout the dashboard.
 */
export const authClient = createAuthClient({
  baseURL: env.NEXT_PUBLIC_APP_URL,
  plugins: [organizationClient(), adminClient()],
});

export const { useSession, signIn, signUp, signOut, useActiveOrganization, useListOrganizations } =
  authClient;
