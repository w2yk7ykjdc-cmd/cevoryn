import "server-only";

import { getValidGoogleAccessToken } from "@/lib/google-connection";

const GMAIL_DRAFTS_URL =
  "https://gmail.googleapis.com/gmail/v1/users/me/drafts";
const CALENDAR_EVENTS_URL =
  "https://www.googleapis.com/calendar/v3/calendars/primary/events";
const GOOGLE_TIMEOUT_MS = 12_000;

export type EmailDraftInput = {
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  body: string;
};

export type CalendarEventInput = {
  title: string;
  start: string;
  end: string;
  timeZone?: string;
  description?: string;
  location?: string;
  attendees?: string[];
};

export async function createGoogleEmailDraft(
  organizationId: string,
  userId: string,
  input: EmailDraftInput
) {
  const accessToken = await getValidGoogleAccessToken(organizationId, userId);
  const raw = buildMimeMessage(input);
  const response = await googleWrite(GMAIL_DRAFTS_URL, accessToken, {
    message: { raw },
  });

  return response as {
    id: string;
    message?: { id?: string; threadId?: string };
  };
}

export async function createGoogleCalendarEvent(
  organizationId: string,
  userId: string,
  input: CalendarEventInput
) {
  const accessToken = await getValidGoogleAccessToken(organizationId, userId);
  const timeZone = input.timeZone?.trim() || "UTC";
  const response = await googleWrite(CALENDAR_EVENTS_URL, accessToken, {
    summary: input.title,
    description: input.description || undefined,
    location: input.location || undefined,
    start: { dateTime: input.start, timeZone },
    end: { dateTime: input.end, timeZone },
    attendees: (input.attendees ?? []).map((email) => ({ email })),
  });

  return response as {
    id: string;
    htmlLink?: string;
    status?: string;
  };
}

async function googleWrite(
  url: string,
  accessToken: string,
  body: unknown
): Promise<unknown> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    cache: "no-store",
    signal: AbortSignal.timeout(GOOGLE_TIMEOUT_MS),
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as {
      error?: { status?: string };
    } | null;
    const providerCode = payload?.error?.status;
    throw new Error(
      providerCode
        ? `Google action failed (${response.status}, ${providerCode})`
        : `Google action failed (${response.status})`
    );
  }

  return response.json();
}

function buildMimeMessage(input: EmailDraftInput): string {
  const headers = [
    `To: ${input.to.join(", ")}`,
    input.cc?.length ? `Cc: ${input.cc.join(", ")}` : null,
    input.bcc?.length ? `Bcc: ${input.bcc.join(", ")}` : null,
    `Subject: ${encodeMimeHeader(input.subject)}`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: 8bit",
  ].filter((value): value is string => Boolean(value));

  return Buffer.from(
    `${headers.join("\r\n")}\r\n\r\n${input.body}`,
    "utf8"
  ).toString("base64url");
}

function encodeMimeHeader(value: string): string {
  if (/^[\x20-\x7E]*$/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}
