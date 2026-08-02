import { Plan, Prisma, SectionType, UsageType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getOpenAIClient } from "@/lib/openai";
import { getSectionSchema } from "@/lib/section-schemas";
import { reserveUsage } from "@/lib/usage-limits";

// Bounds a single call well under the wizard's 60s function budget, so one
// slow/stuck request can't eat the whole run - it fails fast and the
// caller decides whether that section is retryable.
const OPENAI_CALL_TIMEOUT_MS = 20_000;

export async function generateAndSaveSectionContent({
  sectionId,
  sectionType,
  locale,
  projectName,
  userId,
  plan,
}: {
  sectionId: string;
  sectionType: SectionType;
  locale: string;
  projectName: string;
  userId: string;
  plan: Plan;
}): Promise<Record<string, unknown>> {
  const reservation = await reserveUsage(userId, plan, UsageType.GENERATE_COPY, locale);

  try {
    const { name, description, schema } = getSectionSchema(sectionType);

    const response = await getOpenAIClient().responses.create(
      {
        model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
        input: [
          {
            role: "system",
            content:
              "You write concise, persuasive landing page copy. Respond only with the requested fields, in the requested locale, with no placeholder brackets.",
          },
          {
            role: "user",
            content: `Product/project name: "${projectName}". Write copy for a "${sectionType}" section, locale "${locale}". ${description}.`,
          },
        ],
        text: {
          format: { type: "json_schema", name, schema, strict: true },
        },
      },
      { timeout: OPENAI_CALL_TIMEOUT_MS },
    );

    let fields: Record<string, unknown>;
    try {
      fields = JSON.parse(response.output_text);
    } catch {
      throw new Error(`AI response for section type "${sectionType}" was not valid JSON`);
    }

    await prisma.$transaction([
      prisma.sectionContent.upsert({
        where: { sectionId_locale: { sectionId, locale } },
        update: {
          fields: fields as Prisma.InputJsonValue,
          aiGenerated: true,
          aiReviewedAt: null,
          humanEdited: false,
        },
        create: { sectionId, locale, fields: fields as Prisma.InputJsonValue, aiGenerated: true },
      }),
      prisma.apiUsage.update({
        where: { id: reservation.id },
        data: { tokensUsed: response.usage?.total_tokens ?? 0 },
      }),
    ]);

    return fields;
  } catch (e) {
    // The reservation already booked an estimated charge against this
    // month's budget so a concurrent call can't race past it - a failed
    // call shouldn't actually cost the user anything, so release it.
    await prisma.apiUsage
      .update({ where: { id: reservation.id }, data: { tokensUsed: 0 } })
      .catch(() => {});
    throw e;
  }
}
