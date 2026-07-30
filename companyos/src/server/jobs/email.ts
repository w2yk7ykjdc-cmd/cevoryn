import "server-only";
import { env } from "@/env";
import { logger } from "@/server/logger/logger";

export type SendEmailInput = {
  to: string;
  subject: string;
  html: string;
};

/**
 * Minimal Resend REST client — deliberately not an SDK dependency, since
 * transactional email is a single POST request. If `RESEND_API_KEY` isn't
 * set (e.g. local dev), this logs the email instead of sending it so the
 * rest of the invitation/notification flow still works end-to-end.
 */
export async function sendEmail(input: SendEmailInput): Promise<void> {
  if (!env.RESEND_API_KEY) {
    logger.info({ to: input.to, subject: input.subject }, "[dev] email not sent (no RESEND_API_KEY)");
    return;
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: env.EMAIL_FROM,
      to: input.to,
      subject: input.subject,
      html: input.html,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Resend request failed (${response.status}): ${body}`);
  }
}
