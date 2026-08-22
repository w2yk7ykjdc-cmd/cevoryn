import { NextResponse } from "next/server";
import { z } from "zod";

import {
  badRequestResponse,
  internalErrorResponse,
  unauthorizedResponse,
} from "@/lib/api-utils";
import { getUser } from "@/lib/auth";
import { ROUTES } from "@/lib/constants";
import { createClient } from "@/lib/supabase/server";

const updateEmailSchema = z.object({
  email: z.string().trim().toLowerCase().email("Invalid email address"),
});

function getAppUrl(): string {
  const configuredUrl = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (configuredUrl) return configuredUrl.replace(/\/$/, "");
  const productionUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (productionUrl) return `https://${productionUrl.replace(/\/$/, "")}`;
  return "http://localhost:3000";
}

/**
 * Changes the account's login email via Supabase Auth's own email-change
 * flow (supabase.auth.updateUser({ email })) - this does NOT take effect
 * immediately. Supabase sends a confirmation link (to the new address, and
 * to the old address too if "Secure email change" is enabled on the
 * Supabase project) that must be clicked before the change applies. That
 * link redirects through the existing /auth/callback route, which already
 * handles any Supabase auth confirmation type generically.
 *
 * No Prisma table stores email anywhere in this app - every table keys by
 * Supabase's stable user id (Member.userId, google_connections.user_id,
 * etc.), never by email - so this route never touches organization,
 * billing, or Google-integration data. getUser() always reads the email
 * live from the current Supabase session, so it reflects the new address
 * automatically once the user confirms.
 */
export async function PATCH(request: Request) {
  try {
    const user = await getUser();
    if (!user) return unauthorizedResponse();

    let body: unknown;
    try {
      body = await request.json();
    } catch (_error) {
      return badRequestResponse("Invalid body");
    }

    const parsed = updateEmailSchema.safeParse(body);
    if (!parsed.success) {
      return badRequestResponse("Enter a valid email address");
    }

    const newEmail = parsed.data.email;
    if (newEmail === user.email.toLowerCase()) {
      return badRequestResponse("This is already your current email address");
    }

    const supabase = await createClient();
    const { error } = await supabase.auth.updateUser(
      { email: newEmail },
      {
        emailRedirectTo: `${getAppUrl()}${ROUTES.AUTH_CALLBACK}?next=${encodeURIComponent("/profile")}`,
      }
    );

    if (error) {
      const normalized = error.message.toLowerCase();
      if (
        normalized.includes("already registered") ||
        normalized.includes("already exists") ||
        normalized.includes("already been registered")
      ) {
        return NextResponse.json(
          {
            error: {
              code: "EMAIL_IN_USE",
              message:
                "This email address is already in use by another account",
            },
          },
          { status: 409 }
        );
      }

      return NextResponse.json(
        { error: { code: "EMAIL_UPDATE_FAILED", message: error.message } },
        { status: 400 }
      );
    }

    return NextResponse.json({
      data: {
        pendingEmail: newEmail,
        message:
          "Confirmation link sent - check your inbox to complete the change",
      },
    });
  } catch (error) {
    return internalErrorResponse(
      "Email update",
      error,
      "Failed to start email change"
    );
  }
}
