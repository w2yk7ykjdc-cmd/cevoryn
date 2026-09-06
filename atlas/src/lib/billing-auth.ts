import type { NextResponse } from "next/server";
import "server-only";

import { forbiddenResponse, unauthorizedResponse } from "@/lib/api-utils";
import { getMembership, getUser } from "@/lib/auth";
import { isRoleAtLeast } from "@/lib/rbac";
import type { AuthUser, MembershipContext } from "@/types";

export type BillingAdminAuth =
  | { ok: true; user: AuthUser; membership: MembershipContext }
  | { ok: false; response: NextResponse };

/**
 * Shared gate for the four billing API routes: authenticated user, org
 * membership, and ADMIN-or-above role. Each route still owns its own
 * rate-limit key/message on top of this, since those differ per action.
 */
export async function requireBillingAdmin(): Promise<BillingAdminAuth> {
  const user = await getUser();
  if (!user) {
    return { ok: false, response: unauthorizedResponse() };
  }

  const membership = await getMembership(user.id);
  if (!membership) {
    return {
      ok: false,
      response: forbiddenResponse("Organization membership is required."),
    };
  }

  if (!isRoleAtLeast(membership.role, "ADMIN")) {
    return {
      ok: false,
      response: forbiddenResponse(
        "Only organization owners and admins can manage billing."
      ),
    };
  }

  return { ok: true, user, membership };
}
