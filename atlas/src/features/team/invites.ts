import { APP_CONFIG } from "@/lib/constants";
import type { MemberRole } from "@/types";

export const INVITE_TOKEN_LENGTH = 24;

export type InviteEligibilityInput = {
  memberCount: number;
  existingPendingInvite: boolean;
  existingMember: boolean;
};

export type InviteEligibilityResult =
  { ok: true } | { ok: false; message: string };

export function normalizeInviteEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function getInviteExpiresAt(now = new Date()): Date {
  return new Date(
    now.getTime() + APP_CONFIG.inviteExpirationDays * 24 * 60 * 60 * 1000
  );
}

export function canCreateInvite({
  memberCount,
  existingPendingInvite,
  existingMember,
}: InviteEligibilityInput): InviteEligibilityResult {
  if (memberCount >= APP_CONFIG.maxMembersPerOrg) {
    return {
      ok: false,
      message: `Maximum ${APP_CONFIG.maxMembersPerOrg} members per organization`,
    };
  }

  if (existingMember) {
    return { ok: false, message: "This user is already a team member" };
  }

  if (existingPendingInvite) {
    return {
      ok: false,
      message: "An invite for this email is already pending",
    };
  }

  return { ok: true };
}

export function getInviteAcceptPath(token: string): string {
  return `/invite/${encodeURIComponent(token)}`;
}

export function canAcceptInvite({
  inviteEmail,
  userEmail,
  status,
  expiresAt,
  now = new Date(),
}: {
  inviteEmail: string;
  userEmail: string;
  status: string;
  expiresAt: Date;
  now?: Date;
}): InviteEligibilityResult {
  if (status !== "PENDING") {
    return { ok: false, message: "This invite is no longer pending" };
  }

  if (expiresAt.getTime() <= now.getTime()) {
    return { ok: false, message: "This invite has expired" };
  }

  if (normalizeInviteEmail(inviteEmail) !== normalizeInviteEmail(userEmail)) {
    return {
      ok: false,
      message: "Sign in with the email address that received this invite",
    };
  }

  return { ok: true };
}

export function isInviteRole(
  role: string
): role is Extract<MemberRole, "ADMIN" | "MEMBER"> {
  return role === "ADMIN" || role === "MEMBER";
}
