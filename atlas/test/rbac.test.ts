import assert from "node:assert/strict";
import test from "node:test";

import {
  canModifyMember,
  hasPermission,
  isRoleAtLeast,
} from "../src/lib/rbac";

test("members cannot perform organization or team mutations", () => {
  assert.equal(hasPermission("MEMBER", "org:update"), false);
  assert.equal(hasPermission("MEMBER", "org:delete"), false);
  assert.equal(hasPermission("MEMBER", "members:invite"), false);
  assert.equal(hasPermission("MEMBER", "members:remove"), false);
  assert.equal(hasPermission("MEMBER", "members:update-role"), false);
  assert.equal(hasPermission("MEMBER", "settings:update"), false);
});

test("admins can manage standard members but cannot change roles", () => {
  assert.equal(hasPermission("ADMIN", "org:update"), true);
  assert.equal(hasPermission("ADMIN", "members:invite"), true);
  assert.equal(hasPermission("ADMIN", "members:remove"), true);
  assert.equal(hasPermission("ADMIN", "members:update-role"), false);
  assert.equal(hasPermission("ADMIN", "org:delete"), false);

  assert.equal(canModifyMember("ADMIN", "MEMBER"), true);
  assert.equal(canModifyMember("ADMIN", "ADMIN"), false);
  assert.equal(canModifyMember("ADMIN", "OWNER"), false);
});

test("only owners can modify administrator or member roles", () => {
  assert.equal(hasPermission("OWNER", "members:update-role"), true);
  assert.equal(hasPermission("OWNER", "org:delete"), true);
  assert.equal(canModifyMember("OWNER", "ADMIN"), true);
  assert.equal(canModifyMember("OWNER", "MEMBER"), true);
  assert.equal(canModifyMember("OWNER", "OWNER"), false);
});

test("role hierarchy is monotonic", () => {
  assert.equal(isRoleAtLeast("OWNER", "ADMIN"), true);
  assert.equal(isRoleAtLeast("ADMIN", "MEMBER"), true);
  assert.equal(isRoleAtLeast("MEMBER", "ADMIN"), false);
});
