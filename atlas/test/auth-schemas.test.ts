/**
 * Coverage for the auth Zod schemas' validation rules — email normalization,
 * password complexity, and the confirm-password refinement shared by signup
 * and reset-password. Pure logic, no DOM or server imports required.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  forgotPasswordSchema,
  loginSchema,
  resetPasswordSchema,
  signupSchema,
} from "../src/features/auth/schemas/auth";

test("loginSchema trims and lowercases the email", () => {
  const result = loginSchema.safeParse({
    email: "  User@Example.com  ",
    password: "password123",
  });
  assert.ok(result.success);
  assert.equal(result.data.email, "user@example.com");
});

test("loginSchema rejects an invalid email", () => {
  const result = loginSchema.safeParse({
    email: "not-an-email",
    password: "password123",
  });
  assert.equal(result.success, false);
});

test("loginSchema rejects a password shorter than 8 characters", () => {
  const result = loginSchema.safeParse({
    email: "user@example.com",
    password: "short",
  });
  assert.equal(result.success, false);
});

test("signupSchema accepts a matching, sufficiently complex password", () => {
  const result = signupSchema.safeParse({
    email: "user@example.com",
    password: "Password1",
    confirmPassword: "Password1",
  });
  assert.ok(result.success);
});

test("signupSchema rejects a password missing uppercase/lowercase/digit complexity", () => {
  const result = signupSchema.safeParse({
    email: "user@example.com",
    password: "alllowercase",
    confirmPassword: "alllowercase",
  });
  assert.equal(result.success, false);
});

test("signupSchema rejects mismatched confirmPassword, attributing the error to that field", () => {
  const result = signupSchema.safeParse({
    email: "user@example.com",
    password: "Password1",
    confirmPassword: "Password2",
  });
  assert.equal(result.success, false);
  if (!result.success) {
    assert.deepEqual(result.error.issues[0]?.path, ["confirmPassword"]);
  }
});

test("forgotPasswordSchema normalizes email the same way as login", () => {
  const result = forgotPasswordSchema.safeParse({
    email: "  User@Example.com  ",
  });
  assert.ok(result.success);
  assert.equal(result.data.email, "user@example.com");
});

test("resetPasswordSchema accepts a matching, complex password with no email field", () => {
  const result = resetPasswordSchema.safeParse({
    password: "Password1",
    confirmPassword: "Password1",
  });
  assert.ok(result.success);
});

test("resetPasswordSchema rejects mismatched passwords", () => {
  const result = resetPasswordSchema.safeParse({
    password: "Password1",
    confirmPassword: "Password2",
  });
  assert.equal(result.success, false);
});
