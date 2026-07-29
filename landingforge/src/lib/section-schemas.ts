import { SectionType } from "@prisma/client";

type SectionSchema = {
  name: string;
  description: string;
  schema: Record<string, unknown>;
};

export function getSectionSchema(type: SectionType): SectionSchema {
  switch (type) {
    case SectionType.HERO:
      return {
        name: "hero_section",
        description: "Landing page hero section copy",
        schema: {
          type: "object",
          properties: {
            headline: { type: "string" },
            subheadline: { type: "string" },
            ctaText: { type: "string" },
          },
          required: ["headline", "subheadline", "ctaText"],
          additionalProperties: false,
        },
      };
    case SectionType.FEATURES:
      return {
        name: "features_section",
        description: "Landing page features section copy",
        schema: {
          type: "object",
          properties: {
            title: { type: "string" },
            items: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  title: { type: "string" },
                  description: { type: "string" },
                },
                required: ["title", "description"],
                additionalProperties: false,
              },
              minItems: 3,
              maxItems: 6,
            },
          },
          required: ["title", "items"],
          additionalProperties: false,
        },
      };
    case SectionType.PRICING:
      return {
        name: "pricing_section",
        description: "Landing page pricing section copy",
        schema: {
          type: "object",
          properties: {
            title: { type: "string" },
            plans: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  name: { type: "string" },
                  price: { type: "string" },
                  features: { type: "array", items: { type: "string" } },
                },
                required: ["name", "price", "features"],
                additionalProperties: false,
              },
            },
          },
          required: ["title", "plans"],
          additionalProperties: false,
        },
      };
    case SectionType.TESTIMONIALS:
      return {
        name: "testimonials_section",
        description: "Landing page testimonials section copy",
        schema: {
          type: "object",
          properties: {
            title: { type: "string" },
            items: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  quote: { type: "string" },
                  author: { type: "string" },
                  role: { type: "string" },
                },
                required: ["quote", "author", "role"],
                additionalProperties: false,
              },
            },
          },
          required: ["title", "items"],
          additionalProperties: false,
        },
      };
    case SectionType.CTA:
      return {
        name: "cta_section",
        description: "Landing page call-to-action section copy",
        schema: {
          type: "object",
          properties: {
            headline: { type: "string" },
            subheadline: { type: "string" },
            buttonText: { type: "string" },
          },
          required: ["headline", "subheadline", "buttonText"],
          additionalProperties: false,
        },
      };
    case SectionType.FAQ:
      return {
        name: "faq_section",
        description: "Landing page FAQ section copy",
        schema: {
          type: "object",
          properties: {
            title: { type: "string" },
            items: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  question: { type: "string" },
                  answer: { type: "string" },
                },
                required: ["question", "answer"],
                additionalProperties: false,
              },
              minItems: 3,
              maxItems: 8,
            },
          },
          required: ["title", "items"],
          additionalProperties: false,
        },
      };
    case SectionType.FOOTER:
      return {
        name: "footer_section",
        description: "Landing page footer section copy",
        schema: {
          type: "object",
          properties: {
            text: { type: "string" },
            links: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  label: { type: "string" },
                  href: { type: "string" },
                },
                required: ["label", "href"],
                additionalProperties: false,
              },
            },
          },
          required: ["text", "links"],
          additionalProperties: false,
        },
      };
    case SectionType.CUSTOM:
      return {
        name: "custom_section",
        description: "Freeform landing page section copy",
        schema: {
          type: "object",
          properties: {
            title: { type: "string" },
            body: { type: "string" },
          },
          required: ["title", "body"],
          additionalProperties: false,
        },
      };
  }
}
