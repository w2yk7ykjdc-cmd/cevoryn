import { env } from "@/env";
import { sendEmail } from "@/server/jobs/email";
import type { JobPayload } from "@/server/jobs/types";

export async function sendInvitationEmailProcessor(
  data: JobPayload<"send-invitation-email">,
): Promise<void> {
  const acceptUrl = `${env.APP_URL}/accept-invitation/${data.invitationId}`;

  await sendEmail({
    to: data.inviteeEmail,
    subject: `${data.inviterEmail} invited you to join ${data.organizationName} on CompanyOS`,
    html: `
      <p>${data.inviterEmail} invited you to join <strong>${data.organizationName}</strong> as a ${data.role}.</p>
      <p><a href="${acceptUrl}">Accept invitation</a></p>
      <p>This invitation link expires in 7 days.</p>
    `,
  });
}
