import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  canAcceptInvite,
  canCreateInvite,
  getInviteAcceptPath,
  getInviteExpiresAt,
  isInviteRole,
  normalizeInviteEmail,
} from "../src/features/team/invites";

describe("team invite helpers", () => {
  it("normalizes invite emails", () => {
    assert.equal(
      normalizeInviteEmail("  Owner@Example.COM "),
      "owner@example.com"
    );
  });

  it("computes the configured invite expiration", () => {
    assert.equal(
      getInviteExpiresAt(new Date("2026-07-20T00:00:00.000Z")).toISOString(),
      "2026-07-27T00:00:00.000Z"
    );
  });

  it("rejects duplicate, existing-member, and full-team invites", () => {
    assert.deepEqual(
      canCreateInvite({
        memberCount: 20,
        existingPendingInvite: false,
        existingMember: false,
      }),
      { ok: false, message: "Maximum 20 members per organization" }
    );
    assert.deepEqual(
      canCreateInvite({
        memberCount: 1,
        existingPendingInvite: false,
        existingMember: true,
      }),
      { ok: false, message: "This user is already a team member" }
    );
    assert.deepEqual(
      canCreateInvite({
        memberCount: 1,
        existingPendingInvite: true,
        existingMember: false,
      }),
      { ok: false, message: "An invite for this email is already pending" }
    );
  });

  it("validates invite acceptance", () => {
    const base = {
      inviteEmail: "teammate@example.com",
      userEmail: "Teammate@Example.com",
      status: "PENDING",
      expiresAt: new Date("2026-07-21T00:00:00.000Z"),
      now: new Date("2026-07-20T00:00:00.000Z"),
    };
    assert.deepEqual(canAcceptInvite(base), { ok: true });
    assert.equal(canAcceptInvite({ ...base, status: "ACCEPTED" }).ok, false);
    assert.equal(
      canAcceptInvite({ ...base, now: new Date("2026-07-22T00:00:00.000Z") })
        .ok,
      false
    );
    assert.equal(
      canAcceptInvite({ ...base, userEmail: "other@example.com" }).ok,
      false
    );
  });

  it("builds safe accept paths and limits invite roles", () => {
    assert.equal(getInviteAcceptPath("abc/123"), "/invite/abc%2F123");
    assert.equal(isInviteRole("ADMIN"), true);
    assert.equal(isInviteRole("OWNER"), false);
  });
});
