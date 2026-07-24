import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import {
  badRequestResponse,
  forbiddenResponse,
  internalErrorResponse,
  unauthorizedResponse,
} from "@/lib/api-utils";
import { getMembership, getUser } from "@/lib/auth";
import { createGoogleCalendarEvent } from "@/lib/google-actions";
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
    const parsed = parseCalendarEvent(body);
    if (!parsed.ok) return badRequestResponse(parsed.message);

    const result = await createGoogleCalendarEvent(
      membership.organizationId,
      user.id,
      parsed.data
    );

    return NextResponse.json(
      {
        data: {
          created: true,
          eventId: result.id,
          eventUrl: result.htmlLink ?? null,
          status: result.status ?? null,
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
      "Google calendar event",
      error,
      "The calendar event could not be created"
    );
  }
}

function parseCalendarEvent(
  value: unknown
):
  | {
      ok: true;
      data: {
        title: string;
        start: string;
        end: string;
        timeZone?: string;
        description?: string;
        location?: string;
        attendees?: string[];
      };
    }
  | { ok: false; message: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, message: "Invalid request body" };
  }

  const body = value as Record<string, unknown>;
  if (body.approved !== true) {
    return { ok: false, message: "Explicit approval is required" };
  }

  const title = cleanText(body.title, 200);
  const start = parseDate(body.start);
  const end = parseDate(body.end);
  if (!title) return { ok: false, message: "Event title is required" };
  if (!start || !end) return { ok: false, message: "Valid start and end times are required" };
  if (end.getTime() <= start.getTime()) {
    return { ok: false, message: "Event end must be after its start" };
  }
  if (end.getTime() - start.getTime() > 14 * 24 * 60 * 60 * 1000) {
    return { ok: false, message: "Event duration is too long" };
  }

  const attendees = parseEmails(body.attendees, 50);
  if (attendees === null) return { ok: false, message: "Invalid attendee email" };

  const timeZone = cleanText(body.timeZone, 80);
  const description = cleanMultiline(body.description, 10_000);
  const location = cleanText(body.location, 500);

  return {
    ok: true,
    data: {
      title,
      start: start.toISOString(),
      end: end.toISOString(),
      timeZone: timeZone || undefined,
      description: description || undefined,
      location: location || undefined,
      attendees: attendees.length ? attendees : undefined,
    },
  };
}

function parseDate(value: unknown): Date | null {
  if (typeof value !== "string" || value.length > 100) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function parseEmails(value: unknown, max: number): string[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > max) return null;

  const emails = value.map((item) =>
    typeof item === "string" ? item.trim().toLowerCase() : ""
  );
  if (!emails.every((email) => email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
    return null;
  }
  return Array.from(new Set(emails));
}

function cleanText(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return value.replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

function cleanMultiline(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return value.replace(/\r\n/g, "\n").trim().slice(0, max);
}
