import { NextResponse } from "next/server";
import { Webhook, WebhookVerificationError } from "standardwebhooks";

import { getMembership, getUser } from "@/lib/auth";
import { captureServerError } from "@/lib/error-reporting";
import { isRoleAtLeast } from "@/lib/rbac";

export const runtime = "nodejs";

/**
 * TEMPORARY, admin-gated diagnostic endpoint. Not a mock: it drives the
 * exact same `standardwebhooks` `Webhook.verify()` call and the exact same
 * `captureServerError("polar-webhook-signature", ...)` call that
 * src/app/api/billing/polar/webhook/route.ts uses on a real signature
 * failure - the only difference is the signature is deliberately produced
 * with a mismatched secret instead of coming from Polar. This exists to
 * prove Sentry receives events from that code path without needing an
 * external HTTP client to forge a webhook POST.
 *
 * DELETE this route (and this directory, if left empty) once the Sentry
 * delivery has been confirmed in the dashboard - see the PR description
 * for the removal checklist.
 */
export async function GET(): Promise<NextResponse> {
  const user = await getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const membership = await getMembership(user.id);
  if (!membership || !isRoleAtLeast(membership.role, "ADMIN")) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  const eventId = `debug-test-${Date.now()}`;
  const payload = JSON.stringify({ type: "subscription.active", data: {} });
  const timestamp = new Date();

  const signer = new Webhook(
    Buffer.from("debug-test-wrong-secret", "utf-8").toString("base64")
  );
  const signature = signer.sign(eventId, timestamp, payload);

  const verifier = new Webhook(
    Buffer.from("debug-test-real-secret", "utf-8").toString("base64")
  );

  try {
    verifier.verify(payload, {
      "webhook-id": eventId,
      "webhook-timestamp": String(Math.floor(timestamp.getTime() / 1000)),
      "webhook-signature": signature,
    });

    return NextResponse.json(
      {
        ok: false,
        message:
          "Expected signature verification to fail, but it succeeded. This test is broken - no event was sent to Sentry.",
      },
      { status: 500 }
    );
  } catch (error) {
    if (!(error instanceof WebhookVerificationError)) {
      return NextResponse.json(
        {
          ok: false,
          message: "Unexpected error type, not a WebhookVerificationError.",
          error: String(error),
        },
        { status: 500 }
      );
    }

    captureServerError("polar-webhook-signature", error, {
      eventId,
      debugTest: true,
    });

    return NextResponse.json({
      ok: true,
      message:
        "A real WebhookVerificationError was thrown and reported to Sentry with tag scope=polar-webhook-signature. Check the Sentry Issues tab.",
      eventId,
    });
  }
}
