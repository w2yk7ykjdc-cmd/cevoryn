import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import {
  badRequestResponse,
  forbiddenResponse,
  internalErrorResponse,
  unauthorizedResponse,
} from "@/lib/api-utils";
import { getMembership, getUser } from "@/lib/auth";
import { createGoogleEmailDraft } from "@/lib/google-actions";
import { GoogleConnectionError } from "@/lib/google-connection";
import { hasPermission } from "@/lib/rbac";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const user = await getUser();
    if (!user) return unauthorizedResponse();

    const membership = await getMembership(user.id);
    if (!membership) return forbiddenResponse();
    if (!hasPermission(membership.role, "ai:use")) {
      return forbiddenResponse("Insufficient permissions");
    }

    const body = await request.json().catch(() => null);
    const parsed = parseEmailDraft(body);
    if (!parsed.ok) return badRequestResponse(parsed.message);

    const result = await createGoogleEmailDraft(
      membership.organizationId,
      user.id,
      parsed.data
    );

    return NextResponse.json(
      {
        data: {
          created: true,
          draftId: result.id,
          messageId: result.message?.id ?? null,
        },
      },
      { status: 201 }
    );
  } catch (error) {
    if (error instanceof GoogleConnectionError) {
      return NextResponse.json(
        { error: { code: error.code, message: error.message } },
        { status: 409 }
      );
    }

    return internalErrorResponse(
      "Google email draft",
      error,
      "The Gmail draft could not be created"
    );
  }
}

type DraftPayload = {
  approved: true;
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  body: string;
};

function parseEmailDraft(
  value: unknown
): { ok: true; data: Omit<DraftPayload, "approved"> } | { ok: false; message: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, message: "Invalid request body" };
  }

  const body = value as Record<string, unknown>;
  if (body.approved !== true) {
    return { ok: false, message: "Explicit approval is required" };
  }

  const to = parseEmails(body.to, 20);
  const cc = parseEmails(body.cc, 20, true);
  const bcc = parseEmails(body.bcc, 20, true);
  if (!to || to.length === 0) return { ok: false, message: "A valid recipient is required" };
  if (cc === null || bcc === null) return { ok: false, message: "Invalid email address" };

  const subject = cleanText(body.subject, 200);
  const messageBody = cleanText(body.body, 20_000, true);
  if (!subject) return { ok: false, message: "Subject is required" };
  if (!messageBody) return { ok: false, message: "Message body is required" };

  return {
    ok: true,
    data: {
      to,
      cc: cc.length ? cc : undefined,
      bcc: bcc.length ? bcc : undefined,
      subject,
      body: messageBody,
    },
  };
}

function parseEmails(value: unknown, max: number, optional = false): string[] | null {
  if (value === undefined && optional) return [];
  if (!Array.isArray(value) || value.length > max) return null;

  const emails = value.map((item) =>
    typeof item === "string" ? item.trim().toLowerCase() : ""
  );
  return emails.every(isEmail) ? Array.from(new Set(emails)) : null;
}

function isEmail(value: string): boolean {
  return value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function cleanText(value: unknown, max: number, preserveLines = false): string {
  if (typeof value !== "string") return "";
  const cleaned = preserveLines
    ? value.replace(/\r\n/g, "\n").trim()
    : value.replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim();
  return cleaned.slice(0, max);
}
