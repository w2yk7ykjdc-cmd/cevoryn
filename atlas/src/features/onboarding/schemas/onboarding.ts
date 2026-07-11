import { z } from "zod";

import { APP_CONFIG } from "@/lib/constants";

export const onboardingSchema = z.object({
  organizationName: z
    .string()
    .trim()
    .min(2, "Organization name must be at least 2 characters")
    .max(
      APP_CONFIG.orgNameMaxLength,
      `Organization name must be under ${APP_CONFIG.orgNameMaxLength} characters`
    ),
  displayName: z
    .string()
    .trim()
    .min(2, "Your name must be at least 2 characters")
    .max(
      APP_CONFIG.displayNameMaxLength,
      `Name must be under ${APP_CONFIG.displayNameMaxLength} characters`
    ),
});

export type OnboardingInput = z.infer<typeof onboardingSchema>;
