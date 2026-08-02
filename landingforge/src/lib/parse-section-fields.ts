import { SectionType } from "@prisma/client";

// How many item rows the editor renders for each section's array field -
// existing content beyond this count still round-trips (see
// SectionEditorFields), this only bounds how many *empty* extra rows a user
// gets to fill in per save.
export const SECTION_ROW_COUNTS: Record<string, number> = {
  FEATURES: 6,
  PRICING: 4,
  TESTIMONIALS: 6,
  FAQ: 8,
  FOOTER: 6,
};

function str(formData: FormData, name: string): string {
  return ((formData.get(name) as string) ?? "").trim();
}

function rows(
  formData: FormData,
  prefix: string,
  count: number,
  keys: string[],
): Record<string, string>[] {
  const items: Record<string, string>[] = [];
  for (let i = 0; i < count; i++) {
    const row: Record<string, string> = {};
    let hasValue = false;
    for (const key of keys) {
      const value = str(formData, `${prefix}.${i}.${key}`);
      row[key] = value;
      if (value) hasValue = true;
    }
    if (hasValue) items.push(row);
  }
  return items;
}

// Mirrors SectionRenderer's per-type field shape, but builds it from
// submitted form fields instead of AI output. Always returns every key the
// renderer reads (empty string/array when blank) so a partially filled-in
// save can never leave SectionRenderer destructuring `undefined`.
export function parseSectionFields(
  type: SectionType,
  formData: FormData,
): Record<string, unknown> {
  switch (type) {
    case SectionType.HERO:
      return {
        headline: str(formData, "headline"),
        subheadline: str(formData, "subheadline"),
        ctaText: str(formData, "ctaText"),
      };
    case SectionType.CTA:
      return {
        headline: str(formData, "headline"),
        subheadline: str(formData, "subheadline"),
        buttonText: str(formData, "buttonText"),
      };
    case SectionType.CUSTOM:
      return {
        title: str(formData, "title"),
        body: str(formData, "body"),
      };
    case SectionType.FEATURES:
      return {
        title: str(formData, "title"),
        items: rows(formData, "items", SECTION_ROW_COUNTS.FEATURES, [
          "title",
          "description",
        ]),
      };
    case SectionType.TESTIMONIALS:
      return {
        title: str(formData, "title"),
        items: rows(formData, "items", SECTION_ROW_COUNTS.TESTIMONIALS, [
          "quote",
          "author",
          "role",
        ]),
      };
    case SectionType.FAQ:
      return {
        title: str(formData, "title"),
        items: rows(formData, "items", SECTION_ROW_COUNTS.FAQ, [
          "question",
          "answer",
        ]),
      };
    case SectionType.FOOTER:
      return {
        text: str(formData, "text"),
        links: rows(formData, "links", SECTION_ROW_COUNTS.FOOTER, [
          "label",
          "href",
        ]),
      };
    case SectionType.PRICING: {
      const plans: { name: string; price: string; features: string[] }[] = [];
      for (let i = 0; i < SECTION_ROW_COUNTS.PRICING; i++) {
        const name = str(formData, `plans.${i}.name`);
        const price = str(formData, `plans.${i}.price`);
        const features = str(formData, `plans.${i}.features`)
          .split("\n")
          .map((f) => f.trim())
          .filter(Boolean);
        if (name || price || features.length > 0) {
          plans.push({ name, price, features });
        }
      }
      return { title: str(formData, "title"), plans };
    }
  }
}
