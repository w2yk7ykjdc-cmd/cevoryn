import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { organization } from "better-auth/plugins/organization";
import { bearer } from "better-auth/plugins/bearer";
import { admin as adminPlugin } from "better-auth/plugins/admin";
import { nextCookies } from "better-auth/next-js";
import { prisma } from "@/server/db/client";
import { env } from "@/env";
import { logger } from "@/server/logger/logger";
import { publishEvent } from "@/server/events/event-bus";
import { recordAuditLog } from "@/server/audit/audit-log";
import { accessControl, roles } from "@/server/auth/permissions";
import { seedDefaultPipelineStages } from "@/server/leads/pipeline";
import { provisionDefaultSubscription } from "@/server/billing/subscription";
import { assertSafeToDeleteAccount } from "@/server/organizations/lifecycle";

/**
 * Server-side Better Auth instance. This is the single source of truth for
 * authentication, session management, and organization/tenant membership.
 * Do not instantiate a second `betterAuth(...)` anywhere else in the app.
 */
export const auth = betterAuth({
  appName: "CompanyOS",
  baseURL: env.BETTER_AUTH_URL,
  secret: env.BETTER_AUTH_SECRET,
  database: prismaAdapter(prisma, {
    provider: "postgresql",
  }),
  session: {
    expiresIn: 60 * 60 * 24 * 30, // 30 days
    updateAge: 60 * 60 * 24, // refresh once per day of activity
    cookieCache: {
      enabled: true,
      maxAge: 5 * 60, // 5 minutes
    },
  },
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: false,
    minPasswordLength: 10,
  },
  user: {
    deleteUser: {
      enabled: true,
      async beforeDelete(user) {
        await assertSafeToDeleteAccount(user.id);
      },
      async afterDelete(user) {
        logger.warn({ userId: user.id }, "user account permanently deleted");
      },
    },
  },
  socialProviders: {
    ...(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
      ? {
          google: {
            clientId: env.GOOGLE_CLIENT_ID,
            clientSecret: env.GOOGLE_CLIENT_SECRET,
          },
        }
      : {}),
    ...(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET
      ? {
          github: {
            clientId: env.GITHUB_CLIENT_ID,
            clientSecret: env.GITHUB_CLIENT_SECRET,
          },
        }
      : {}),
  },
  rateLimit: {
    enabled: true,
    window: 60,
    max: env.RATE_LIMIT_REQUESTS_PER_MINUTE,
  },
  plugins: [
    organization({
      ac: accessControl,
      roles,
      creatorRole: "owner",
      invitationExpiresIn: 60 * 60 * 24 * 7, // 7 days
      // Better Auth's own /organization/delete endpoint accepts nothing but
      // an id — no confirmation, no billing awareness. Deletion is a
      // permanent, whole-tenant-destroying action, so it's disabled here
      // entirely; `deleteOrganization` (src/server/organizations/lifecycle.ts),
      // called only from `deleteOrganizationAction`, is the sole supported
      // path — it requires typed slug confirmation and cancels any live
      // Stripe subscription before anything is deleted.
      disableOrganizationDeletion: true,
      dynamicAccessControl: {
        enabled: true,
      },
      teams: {
        enabled: false,
      },
      async sendInvitationEmail(data) {
        // Wired to the event bus instead of a direct email call so delivery
        // survives provider outages and can be retried by the job worker.
        await publishEvent("organization.invitation.created", {
          invitationId: data.id,
          organizationId: data.organization.id,
          organizationName: data.organization.name,
          inviterEmail: data.inviter.user.email,
          inviteeEmail: data.email,
          role: data.role,
        });
      },
      organizationHooks: {
        afterCreateOrganization: async ({ organization: org, user }) => {
          await recordAuditLog({
            organizationId: org.id,
            actorId: user.id,
            actorType: "user",
            action: "organization.created",
            targetType: "organization",
            targetId: org.id,
            metadata: { name: org.name, slug: org.slug },
          });
          await seedDefaultPipelineStages(org.id);
          await provisionDefaultSubscription(org.id);
        },
      },
    }),
    adminPlugin({
      defaultRole: "member",
    }),
    bearer(),
    nextCookies(), // must be last: sets cookies on the response for Server Actions
  ],
  logger: {
    disabled: false,
    log(level, message, ...args) {
      logger[level === "error" ? "error" : level === "warn" ? "warn" : "debug"](
        { args },
        `[better-auth] ${message}`,
      );
    },
  },
});

export type Auth = typeof auth;
