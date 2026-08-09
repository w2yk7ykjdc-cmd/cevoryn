import "server-only";

import { getValidGoogleAccessToken } from "@/lib/google-connection";

const GMAIL_API = "https://gmail.googleapis.com/gmail/v1";
const CALENDAR_API = "https://www.googleapis.com/calendar/v3";
const GOOGLE_READ_TIMEOUT_MS = 1_200;

export type GmailContextItem = {
  id: string;
  threadId: string;
  from: string;
  subject: string;
  date: string;
  snippet: string;
};

export type CalendarContextItem = {
  id: string;
  title: string;
  start: string;
  end: string | null;
  location: string | null;
  attendees: string[];
};

type GmailListResponse = {
  messages?: Array<{ id: string; threadId: string }>;
};

type GmailMessageResponse = {
  id: string;
  threadId: string;
  snippet?: string;
  payload?: {
    headers?: Array<{ name: string; value: string }>;
  };
};

type CalendarListResponse = {
  items?: Array<{
    id: string;
    summary?: string;
    location?: string;
    start?: { dateTime?: string; date?: string };
    end?: { dateTime?: string; date?: string };
    attendees?: Array<{ email?: string }>;
  }>;
};

async function googleFetch<T>(url: string, accessToken: string): Promise<T> {
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
    signal: AbortSignal.timeout(GOOGLE_READ_TIMEOUT_MS),
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as {
      error?: { status?: string };
    } | null;
    const providerCode = payload?.error?.status;
    throw new Error(
      providerCode
        ? `Google API request failed (${response.status}, ${providerCode})`
        : `Google API request failed (${response.status})`
    );
  }

  return (await response.json()) as T;
}

function headerValue(message: GmailMessageResponse, name: string) {
  return (
    message.payload?.headers?.find(
      (header) => header.name.toLowerCase() === name.toLowerCase()
    )?.value ?? ""
  );
}

export async function getRecentGmailContext(
  organizationId: string,
  userId: string,
  limit = 5
): Promise<GmailContextItem[]> {
  const accessToken = await getValidGoogleAccessToken(organizationId, userId);
  const listUrl = new URL(`${GMAIL_API}/users/me/messages`);
  listUrl.searchParams.set(
    "maxResults",
    String(Math.min(Math.max(limit, 1), 10))
  );
  listUrl.searchParams.set("q", "newer_than:7d -in:spam -in:trash");

  const list = await googleFetch<GmailListResponse>(
    listUrl.toString(),
    accessToken
  );
  const messages = list.messages ?? [];

  return Promise.all(
    messages.map(async ({ id }) => {
      const detailUrl = new URL(`${GMAIL_API}/users/me/messages/${id}`);
      detailUrl.searchParams.set("format", "metadata");
      detailUrl.searchParams.append("metadataHeaders", "From");
      detailUrl.searchParams.append("metadataHeaders", "Subject");
      detailUrl.searchParams.append("metadataHeaders", "Date");

      const message = await googleFetch<GmailMessageResponse>(
        detailUrl.toString(),
        accessToken
      );

      return {
        id: message.id,
        threadId: message.threadId,
        from: headerValue(message, "From"),
        subject: headerValue(message, "Subject") || "(No subject)",
        date: headerValue(message, "Date"),
        snippet: message.snippet ?? "",
      };
    })
  );
}

export async function getUpcomingCalendarContext(
  organizationId: string,
  userId: string,
  days = 7,
  limit = 10
): Promise<CalendarContextItem[]> {
  const accessToken = await getValidGoogleAccessToken(organizationId, userId);
  const timeMin = new Date();
  const timeMax = new Date(timeMin.getTime() + days * 24 * 60 * 60 * 1000);
  const url = new URL(`${CALENDAR_API}/calendars/primary/events`);
  url.searchParams.set("timeMin", timeMin.toISOString());
  url.searchParams.set("timeMax", timeMax.toISOString());
  url.searchParams.set("singleEvents", "true");
  url.searchParams.set("orderBy", "startTime");
  url.searchParams.set("maxResults", String(Math.min(Math.max(limit, 1), 20)));

  const data = await googleFetch<CalendarListResponse>(
    url.toString(),
    accessToken
  );

  return (data.items ?? []).map((event) => ({
    id: event.id,
    title: event.summary ?? "Untitled event",
    start: event.start?.dateTime ?? event.start?.date ?? "",
    end: event.end?.dateTime ?? event.end?.date ?? null,
    location: event.location ?? null,
    attendees: (event.attendees ?? [])
      .map((attendee) => attendee.email)
      .filter((email): email is string => Boolean(email)),
  }));
}

export async function getGoogleWorkspaceContext(
  organizationId: string,
  userId: string
) {
  const [emails, events] = await Promise.all([
    getRecentGmailContext(organizationId, userId),
    getUpcomingCalendarContext(organizationId, userId),
  ]);

  return {
    generatedAt: new Date().toISOString(),
    emails,
    events,
  };
}
