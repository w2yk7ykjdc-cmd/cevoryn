"use client";

import { ExternalLink, Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { handleUnauthorized } from "@/lib/client-auth";

interface HistoryActionButtonProps {
  id: string;
  type: string;
  title: string;
  description: string;
}

export function HistoryActionButton({ id, type, title, description }: HistoryActionButtonProps) {
  const [loading, setLoading] = useState(false);

  async function relaunch() {
    setLoading(true);
    try {
      const response = await fetch(`/api/brain/actions/${id}`);
      if (handleUnauthorized(response)) return;
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.error?.message ?? "Action details could not be loaded");
      }

      const content = asRecord(payload?.data?.content);
      if (type === "EMAIL_DRAFT") {
        const to = text(content.to);
        const subject = text(content.subject) || title;
        const body = text(content.body) || description;
        window.location.href = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
        return;
      }

      if (type === "CALENDAR_PROPOSAL") {
        const params = new URLSearchParams({
          action: "TEMPLATE",
          text: text(content.title) || title,
          details: text(content.description) || description,
        });
        const dates = buildCalendarDates(text(content.suggestedDate), text(content.duration));
        if (dates) params.set("dates", dates);
        window.location.href = `https://calendar.google.com/calendar/render?${params.toString()}`;
        return;
      }

      const note = Object.entries(content)
        .map(([key, value]) => `${formatLabel(key)}: ${formatValue(value)}`)
        .filter((line) => !line.endsWith(": "))
        .join("\n");
      const value = note ? `${title}\n\n${note}` : `${title}\n\n${description}`;
      const copied = await copyText(value);
      toast.success(copied ? "Execution note copied." : "Open the action details and copy them manually.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Action could not be reopened");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Button type="button" variant="ghost" size="sm" disabled={loading} onClick={relaunch}>
      {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ExternalLink className="h-3.5 w-3.5" />}
      Reopen
    </Button>
  );
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
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map(String).join(", ");
  return "";
}

function formatLabel(value: string): string {
  return value.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/_/g, " ").replace(/^./, (letter) => letter.toUpperCase());
}

function buildCalendarDates(suggestedDate: string, duration: string): string | null {
  const start = new Date(suggestedDate);
  if (Number.isNaN(start.getTime())) return null;
  const parsedMinutes = Number.parseInt(duration, 10);
  const minutes = Number.isFinite(parsedMinutes) ? parsedMinutes : 30;
  const end = new Date(start.getTime() + minutes * 60_000);
  return `${toCalendarUtc(start)}/${toCalendarUtc(end)}`;
}

function toCalendarUtc(value: Date): string {
  return value.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
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
    document.body.appendChild(textarea);
    textarea.select();
    const copied = document.execCommand("copy");
    document.body.removeChild(textarea);
    return copied;
  } catch {
    return false;
  }
}
