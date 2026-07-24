import "server-only";

import { AI_CONFIG } from "@/lib/constants";
import { createGoogleEmailDraft } from "@/lib/google-actions";
import { cleanText, parseEmails } from "@/lib/google-utils";
import type { TokenUsage } from "@/types";

import type { AIProvider } from "../providers/types";

type DraftExtraction = {
  intent: "create_gmail_draft" | "none";
  to: string[];
  subject: string;
  body: string;
  missing: string[];
};

type DraftActionResult = {
  content: string;
  usage: TokenUsage;
};

const EXPLICIT_DRAFT_REQUEST =
  /(?:gmail|e[- ]?posta|mail).{0,80}(?:taslak|draft).{0,80}(?:oluştur|hazırla|yaz|create)|(?:taslak|draft).{0,80}(?:gmail|e[- ]?posta|mail).{0,80}(?:oluştur|hazırla|yaz|create)/i;

export async function tryCreateGoogleDraftFromChat(params: {
  message: string;
  organizationId: string;
  userId: string;
  provider: AIProvider;
}): Promise<DraftActionResult | null> {
  const { message, organizationId, userId, provider } = params;

  if (!EXPLICIT_DRAFT_REQUEST.test(message)) return null;

  const completion = await provider.complete({
    model: AI_CONFIG.defaultModel,
    temperature: 0,
    maxTokens: 700,
    messages: [
      {
        role: "system",
        content: [
          "Extract an explicit Gmail draft creation request from the user message.",
          "Return JSON only, with exactly these keys:",
          '{"intent":"create_gmail_draft"|"none","to":string[],"subject":string,"body":string,"missing":string[]}',
          "Never invent an email address, recipient, subject, or message body.",
          "A request to discuss, suggest, review, or show an email is not permission to create a draft.",
          "Only use create_gmail_draft when the user explicitly asks to create/prepare/write a Gmail or email draft.",
          "Put missing required fields among: recipient, subject, body.",
          "Preserve the user's language and intended wording.",
        ].join("\n"),
      },
      { role: "user", content: message },
    ],
  });

  const extracted = parseExtraction(completion.content);
  if (!extracted || extracted.intent !== "create_gmail_draft") return null;

  const to = parseEmails(extracted.to, 20);
  const subject = cleanText(extracted.subject, 200);
  const body = cleanText(extracted.body, 20_000, true);
  const missing = new Set(extracted.missing);

  if (!to || to.length === 0) missing.add("recipient");
  if (!subject) missing.add("subject");
  if (!body) missing.add("body");

  if (missing.size > 0) {
    return {
      content: buildMissingFieldsMessage([...missing]),
      usage: completion.usage,
    };
  }

  const result = await createGoogleEmailDraft(organizationId, userId, {
    to,
    subject,
    body,
  });

  return {
    content: `Gmail taslağı oluşturuldu. Taslak kimliği: ${result.id}`,
    usage: completion.usage,
  };
}

function parseExtraction(content: string): DraftExtraction | null {
  try {
    const normalized = content
      .trim()
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/, "");
    const value = JSON.parse(normalized) as Record<string, unknown>;

    const intent =
      value.intent === "create_gmail_draft" ? "create_gmail_draft" : "none";
    const to = Array.isArray(value.to)
      ? value.to.filter((item): item is string => typeof item === "string")
      : [];
    const subject = typeof value.subject === "string" ? value.subject : "";
    const body = typeof value.body === "string" ? value.body : "";
    const missing = Array.isArray(value.missing)
      ? value.missing.filter((item): item is string => typeof item === "string")
      : [];

    return { intent, to, subject, body, missing };
  } catch {
    return null;
  }
}

function buildMissingFieldsMessage(missing: string[]): string {
  const labels: Record<string, string> = {
    recipient: "alıcı e-posta adresi",
    subject: "konu",
    body: "mesaj metni",
  };
  const fields = missing.map((field) => labels[field] ?? field).join(", ");
  return `Gmail taslağını oluşturmak için şu bilgiler eksik: ${fields}.`;
}
