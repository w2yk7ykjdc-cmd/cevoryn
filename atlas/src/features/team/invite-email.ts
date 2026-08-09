import "server-only";

interface SendTeamInviteEmailInput {
  to: string;
  organizationName: string;
  role: "ADMIN" | "MEMBER";
  acceptPath: string;
  expiresAt: Date;
}

export type InviteEmailResult =
  { sent: true } | { sent: false; reason: "NOT_CONFIGURED" | "PROVIDER_ERROR" };

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export async function sendTeamInviteEmail({
  to,
  organizationName,
  role,
  acceptPath,
  expiresAt,
}: SendTeamInviteEmailInput): Promise<InviteEmailResult> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;

  if (!apiKey || !from || !appUrl) {
    return { sent: false, reason: "NOT_CONFIGURED" };
  }

  const inviteUrl = new URL(acceptPath, appUrl).toString();
  const safeOrganizationName = escapeHtml(organizationName);
  const safeInviteUrl = escapeHtml(inviteUrl);
  const expiry = new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(expiresAt);

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [to],
        subject: `Join ${organizationName} on CEVORYN`,
        text: [
          `You have been invited to join ${organizationName} on CEVORYN as ${role.toLowerCase()}.`,
          "",
          `Accept the invitation: ${inviteUrl}`,
          "",
          `This invitation expires ${expiry} UTC.`,
        ].join("\n"),
        html: `
          <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:32px;color:#111827">
            <h1 style="font-size:24px;margin:0 0 16px">Join ${safeOrganizationName} on CEVORYN</h1>
            <p style="font-size:16px;line-height:1.6;margin:0 0 24px">
              You have been invited as <strong>${role.toLowerCase()}</strong>.
            </p>
            <a href="${safeInviteUrl}" style="display:inline-block;background:#0f172a;color:#ffffff;text-decoration:none;padding:12px 18px;border-radius:8px;font-weight:600">
              Accept invite
            </a>
            <p style="font-size:13px;line-height:1.5;color:#6b7280;margin:24px 0 0">
              This invitation expires ${expiry} UTC. If you were not expecting it, you can ignore this email.
            </p>
          </div>
        `,
      }),
      cache: "no-store",
    });

    if (!response.ok) {
      const providerMessage = await response.text().catch(() => "");
      console.error(
        "Invite email provider error:",
        response.status,
        providerMessage.slice(0, 500)
      );
      return { sent: false, reason: "PROVIDER_ERROR" };
    }

    return { sent: true };
  } catch (error) {
    console.error(
      "Invite email delivery failed:",
      error instanceof Error ? error.message : "unknown"
    );
    return { sent: false, reason: "PROVIDER_ERROR" };
  }
}
