import { z } from "zod";

import { APP_CONFIG } from "@/lib/constants";

interface OnboardingValidationMessages {
  orgNameMin: string;
  orgNameMax: string;
  nameMin: string;
  nameMax: string;
}

export function createOnboardingSchema(messages: OnboardingValidationMessages) {
  return z.object({
    organizationName: z
      .string()
      .trim()
      .min(2, messages.orgNameMin)
      .max(APP_CONFIG.orgNameMaxLength, messages.orgNameMax),
    displayName: z
      .string()
      .trim()
      .min(2, messages.nameMin)
      .max(APP_CONFIG.displayNameMaxLength, messages.nameMax),
  });
}

export type OnboardingInput = z.infer<
  ReturnType<typeof createOnboardingSchema>
>;

const fallbackMessages: OnboardingValidationMessages = {
  orgNameMin: "Organization name must be at least 2 characters",
  orgNameMax: `Organization name must be under ${APP_CONFIG.orgNameMaxLength} characters`,
  nameMin: "Your name must be at least 2 characters",
  nameMax: `Name must be under ${APP_CONFIG.displayNameMaxLength} characters`,
};

export const onboardingSchema = createOnboardingSchema(fallbackMessages);
