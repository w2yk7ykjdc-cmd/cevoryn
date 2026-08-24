import "server-only";

import { AI_CONFIG } from "@/lib/constants";
import { createGoogleCalendarEvent } from "@/lib/google-actions";
import { cleanText, parseEmails } from "@/lib/google-utils";
import type { TokenUsage } from "@/types";

import type { AIProvider } from "../providers/types";

type CalendarExtraction = {
  intent: "create_calendar_event" | "none";
  title: string;
  start: string;
  end: string;
  timeZone: string;
  description: string;
  location: string;
  attendees: string[];
  missing: string[];
};

type CalendarActionResult = {
  content: string;
  usage: TokenUsage;
};

const EXPLICIT_CALENDAR_REQUEST =
  /(?:takvim|calendar|etkinlik|toplantı|randevu).{0,100}(?:oluştur|ekle|ayarla|planla|create|schedule)|(?:oluştur|ekle|ayarla|planla|create|schedule).{0,100}(?:takvim|calendar|etkinlik|toplantı|randevu)/i;

export async function tryCreateGoogleCalendarEventFromChat(params: {
  message: string;
  organizationId: string;
  userId: string;
  provider: AIProvider;
}): Promise<CalendarActionResult | null> {
  const { message, organizationId, userId, provider } = params;

  if (!EXPLICIT_CALENDAR_REQUEST.test(message)) return null;

  const now = new Date();
  const completion = await provider.complete({
    model: AI_CONFIG.defaultModel,
    temperature: 0,
    maxTokens: 900,
    messages: [
      {
        role: "system",
        content: [
          "Extract an explicit Google Calendar event creation request from the user message.",
          "Return JSON only, with exactly these keys:",
          '{"intent":"create_calendar_event"|"none","title":string,"start":string,"end":string,"timeZone":string,"description":string,"location":string,"attendees":string[],"missing":string[]}',
          `Current time: ${now.toISOString()}`,
          "Default time zone: Europe/Istanbul.",
          "Convert relative dates such as tomorrow into exact ISO-8601 timestamps with an offset.",
          "Never invent title, date, start time, end time, duration, attendee, location, or description.",
          "A request to discuss or suggest an event is not permission to create one.",
          "Only use create_calendar_event when the user explicitly asks to add/create/schedule it.",
          "Required fields are title, start and end. If duration/end is missing, mark end as missing.",
          "Put missing required fields among: title, start, end.",
        ].join("\n"),
      },
      { role: "user", content: message },
    ],
  });

  const extracted = parseExtraction(completion.content);
  if (!extracted || extracted.intent !== "create_calendar_event") return null;

  const title = cleanText(extracted.title, 200);
  const start = parseDate(extracted.start);
  const end = parseDate(extracted.end);
  const timeZone = cleanText(extracted.timeZone, 80) || "Europe/Istanbul";
  const description = cleanText(extracted.description, 10_000, true);
  const location = cleanText(extracted.location, 500);
  const attendees = parseEmails(extracted.attendees, 50, true);
  const missing = new Set(extracted.missing);

  if (!title) missing.add("title");
  if (!start) missing.add("start");
  if (!end) missing.add("end");
  if (attendees === null) missing.add("valid attendee email");

  if (start && end && end.getTime() <= start.getTime()) {
    missing.add("end after start");
  }

  if (missing.size > 0 || !start || !end) {
    return {
      content: buildMissingFieldsMessage([...missing]),
      usage: completion.usage,
    };
  }

  const result = await createGoogleCalendarEvent(organizationId, userId, {
    title,
    start: start.toISOString(),
    end: end.toISOString(),
    timeZone,
    description: description || undefined,
    location: location || undefined,
    attendees: attendees && attendees.length ? attendees : undefined,
  });

  return {
    content: `Google Calendar event created. Event ID: ${result.id}`,
    usage: completion.usage,
  };
}

function parseExtraction(content: string): CalendarExtraction | null {
  try {
    const normalized = content
      .trim()
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/, "");
    const value = JSON.parse(normalized) as Record<string, unknown>;

    return {
      intent:
        value.intent === "create_calendar_event"
          ? "create_calendar_event"
          : "none",
      title: typeof value.title === "string" ? value.title : "",
      start: typeof value.start === "string" ? value.start : "",
      end: typeof value.end === "string" ? value.end : "",
      timeZone: typeof value.timeZone === "string" ? value.timeZone : "",
      description:
        typeof value.description === "string" ? value.description : "",
      location: typeof value.location === "string" ? value.location : "",
      attendees: Array.isArray(value.attendees)
        ? value.attendees.filter(
            (item): item is string => typeof item === "string"
          )
        : [],
      missing: Array.isArray(value.missing)
        ? value.missing.filter(
            (item): item is string => typeof item === "string"
          )
        : [],
    };
  } catch {
    return null;
  }
}

function parseDate(value: string): Date | null {
  if (!value || value.length > 100) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function buildMissingFieldsMessage(missing: string[]): string {
  const labels: Record<string, string> = {
    title: "event title",
    start: "start date and time",
    end: "end date and time or duration",
    "valid attendee email": "a valid attendee email address",
    "end after start": "a valid end time after the start time",
  };
  const fields = missing.map((field) => labels[field] ?? field).join(", ");
  return `The following information is missing or invalid to create the calendar event: ${fields}.`;
}
