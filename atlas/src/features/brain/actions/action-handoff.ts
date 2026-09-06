"use client";

import { handleUnauthorized } from "@/lib/client-auth";

/**
 * Shared client-side handoff for an approved prepared action.
 *
 * Approving an action never silently "does nothing": depending on
 * type, it opens the user's email client with a prefilled draft, opens
 * a Google Calendar event template, or copies the execution details to
 * the clipboard so the user can act on them elsewhere. Every path ends
 * with a toast naming exactly what happened.
 */

export interface HandoffActionItem {
  id: string;
  type: string;
  title: string;
  description: string;
}

/** Returns null (instead of throwing) when the session redirect to login already fired. */
export async function fetchActionDetails(id: string): Promise<unknown> {
  const response = await fetch(`/api/brain/actions/${id}`);
  if (handleUnauthorized(response)) return null;

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(
      payload?.error?.message ?? "Action details could not be loaded"
    );
  }

  return payload?.data?.content ?? null;
}

export function getActionPreview(
  type: string,
  value: unknown
): Array<{ label: string; value: string }> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const content = value as Record<string, unknown>;
  const fields: Record<string, Array<[string, string]>> = {
    EMAIL_DRAFT: [
      ["To", "to"],
      ["Subject", "subject"],
      ["Message", "body"],
    ],
    TASK: [
      ["Task", "title"],
      ["Details", "description"],
      ["Due date", "dueDate"],
    ],
    CALENDAR_PROPOSAL: [
      ["Meeting", "title"],
      ["Details", "description"],
      ["Duration", "duration"],
      ["Suggested date", "suggestedDate"],
    ],
    FOLLOW_UP: [
      ["With", "with"],
      ["Topic", "topic"],
      ["Suggested date", "suggestedDate"],
    ],
  };
  return (
    fields[type] ??
    Object.keys(content).map(
      (key) => [formatLabel(key), key] as [string, string]
    )
  )
    .map(([label, key]) => ({ label, value: formatValue(content[key]) }))
    .filter((item) => item.value.length > 0);
}

export async function launchApprovedAction(
  action: HandoffActionItem,
  value: unknown
): Promise<string> {
  const content = asRecord(value);

  if (action.type === "EMAIL_DRAFT") {
    const to = text(content.to);
    const subject = text(content.subject) || action.title;
    const body = text(content.body) || action.description;
    window.location.href = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    await recordExecution(action.id, "MAILTO", "COMPLETED");
    return "Approved. Your email app is opening with the draft.";
  }

  if (action.type === "CALENDAR_PROPOSAL") {
    const title = text(content.title) || action.title;
    const description = text(content.description) || action.description;
    const date = buildCalendarDates(
      text(content.suggestedDate),
      text(content.duration)
    );
    const params = new URLSearchParams({
      action: "TEMPLATE",
      text: title,
      details: description,
    });
    if (date) params.set("dates", date);
    window.location.href = `https://calendar.google.com/calendar/render?${params.toString()}`;
    await recordExecution(action.id, "GOOGLE_CALENDAR_EVENT", "COMPLETED");
    return "Approved. Google Calendar is opening with this event.";
  }

  const note = getActionPreview(action.type, value)
    .map((item) => `${item.label}: ${item.value}`)
    .join("\n");
  const executionNote = note
    ? `${action.title}\n\n${note}`
    : `${action.title}\n\n${action.description}`;

  const copied = await copyText(executionNote);
  await recordExecution(
    action.id,
    "CLIPBOARD",
    copied ? "COMPLETED" : "FAILED"
  );
  return copied
    ? "Approved. Details copied to your clipboard - paste them into your task tool."
    : "Approved. Copy the details from the card to act on them.";
}

/**
 * Best-effort execution record for the Action Engine's audit trail
 * (ActionExecution). Never allowed to affect the user-facing handoff
 * outcome above - a failed recording is logged, not surfaced.
 */
async function recordExecution(
  preparedActionId: string,
  channel: "MAILTO" | "CLIPBOARD" | "GOOGLE_CALENDAR_EVENT",
  status: "COMPLETED" | "FAILED"
): Promise<void> {
  try {
    await fetch(`/api/brain/actions/${preparedActionId}/execute`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ channel, status }),
    });
  } catch (_error) {
    // Non-critical - the approval itself already succeeded.
  }
}

async function copyText(value: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(value);
      return true;
    }

    const textarea = document.createElement("textarea");
    textarea.value = value;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    textarea.style.pointerEvents = "none";
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    textarea.setSelectionRange(0, textarea.value.length);
    const copied = document.execCommand("copy");
    document.body.removeChild(textarea);
    return copied;
  } catch {
    return false;
  }
}

function buildCalendarDates(
  suggestedDate: string,
  duration: string
): string | null {
  const start = new Date(suggestedDate);
  if (Number.isNaN(start.getTime())) return null;

  const minutes = Number.parseInt(duration, 10);
  const end = new Date(
    start.getTime() + (Number.isFinite(minutes) ? minutes : 30) * 60_000
  );
  return `${toCalendarUtc(start)}/${toCalendarUtc(end)}`;
}

function toCalendarUtc(value: Date): string {
  return value
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function formatValue(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean")
    return String(value);
  if (Array.isArray(value)) return value.map(String).join(", ");
  return "";
}

function formatLabel(value: string): string {
  return value
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .replace(/^./, (letter) => letter.toUpperCase());
}
