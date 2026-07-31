import { SectionType, UsageType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getOpenAIClient } from "@/lib/openai";
import { getSectionSchema } from "@/lib/section-schemas";

export async function generateAndSaveSectionContent({
  sectionId,
  sectionType,
  locale,
  projectName,
  userId,
}: {
  sectionId: string;
  sectionType: SectionType;
  locale: string;
  projectName: string;
  userId: string;
}): Promise<Record<string, unknown>> {
  const { name, description, schema } = getSectionSchema(sectionType);

  const response = await getOpenAIClient().responses.create({
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
  });

  const fields = JSON.parse(response.output_text);

  await prisma.$transaction([
    prisma.sectionContent.upsert({
      where: { sectionId_locale: { sectionId, locale } },
      update: { fields, aiGenerated: true, aiReviewedAt: null, humanEdited: false },
      create: { sectionId, locale, fields, aiGenerated: true },
    }),
    prisma.apiUsage.create({
      data: {
        userId,
        type: UsageType.GENERATE_COPY,
        tokensUsed: response.usage?.total_tokens ?? 0,
        locale,
      },
    }),
  ]);

  return fields;
}
