import { z } from "zod";

interface ValidationMessages {
  invalidEmail: string;
  passwordMinLength: string;
  passwordComplexity: string;
  passwordsDoNotMatch: string;
}

export function createLoginSchema(messages: ValidationMessages) {
  return z.object({
    email: z.string().trim().toLowerCase().email(messages.invalidEmail),
    password: z.string().min(8, messages.passwordMinLength),
  });
}

export type LoginInput = z.infer<ReturnType<typeof createLoginSchema>>;

function createSecurePasswordSchema(messages: ValidationMessages) {
  return z
    .string()
    .min(8, messages.passwordMinLength)
    .regex(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/, messages.passwordComplexity);
}

export function createSignupSchema(messages: ValidationMessages) {
  return z
    .object({
      email: z.string().trim().toLowerCase().email(messages.invalidEmail),
      password: createSecurePasswordSchema(messages),
      confirmPassword: z.string(),
    })
    .refine((data) => data.password === data.confirmPassword, {
      message: messages.passwordsDoNotMatch,
      path: ["confirmPassword"],
    });
}

export type SignupInput = z.infer<ReturnType<typeof createSignupSchema>>;

export function createForgotPasswordSchema(messages: ValidationMessages) {
  return z.object({
    email: z.string().trim().toLowerCase().email(messages.invalidEmail),
  });
}

export type ForgotPasswordInput = z.infer<
  ReturnType<typeof createForgotPasswordSchema>
>;

export function createResetPasswordSchema(messages: ValidationMessages) {
  return z
    .object({
      password: createSecurePasswordSchema(messages),
      confirmPassword: z.string(),
    })
    .refine((data) => data.password === data.confirmPassword, {
      message: messages.passwordsDoNotMatch,
      path: ["confirmPassword"],
    });
}

export type ResetPasswordInput = z.infer<
  ReturnType<typeof createResetPasswordSchema>
>;

// English fallback schemas for server-side parsing when a translated
// instance isn't available (messages only affect user-facing text, not
// validation logic, so any locale instance can safely re-validate input).
const fallbackMessages: ValidationMessages = {
  invalidEmail: "Enter a valid email address",
  passwordMinLength: "Password must be at least 8 characters",
  passwordComplexity:
    "Password must include uppercase, lowercase, and a number",
  passwordsDoNotMatch: "Passwords do not match",
};

export const loginSchema = createLoginSchema(fallbackMessages);
export const signupSchema = createSignupSchema(fallbackMessages);
export const forgotPasswordSchema =
  createForgotPasswordSchema(fallbackMessages);
export const resetPasswordSchema = createResetPasswordSchema(fallbackMessages);
