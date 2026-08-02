import { SectionType } from "@prisma/client";
import { SECTION_ROW_COUNTS } from "@/lib/parse-section-fields";

type Fields = Record<string, unknown> | null | undefined;

const inputClass = "rounded border px-3 py-2 text-sm";
const labelClass = "flex flex-col gap-1 text-xs text-gray-500";

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? (value as Record<string, unknown>[]) : [];
}

// Renders one row per existing item plus enough blank spares to add new
// ones - a plain server-rendered form, no client state, matching how the
// rest of this page's forms already work.
function ItemRows({
  prefix,
  minCount,
  items,
  columns,
}: {
  prefix: string;
  minCount: number;
  items: Record<string, unknown>[];
  columns: { key: string; placeholder: string; multiline?: boolean }[];
}) {
  const rowCount = Math.max(minCount, items.length);
  return (
    <div className="flex flex-col gap-2">
      {Array.from({ length: rowCount }).map((_, i) => (
        <div key={i} className="grid gap-2" style={{ gridTemplateColumns: `repeat(${columns.length}, 1fr)` }}>
          {columns.map((col) =>
            col.multiline ? (
              <textarea
                key={col.key}
                name={`${prefix}.${i}.${col.key}`}
                placeholder={col.placeholder}
                defaultValue={asString(items[i]?.[col.key])}
                rows={2}
                className={inputClass}
              />
            ) : (
              <input
                key={col.key}
                name={`${prefix}.${i}.${col.key}`}
                placeholder={col.placeholder}
                defaultValue={asString(items[i]?.[col.key])}
                className={inputClass}
              />
            ),
          )}
        </div>
      ))}
    </div>
  );
}

export function SectionEditorFields({ type, fields }: { type: SectionType; fields: Fields }) {
  const f = fields ?? {};

  switch (type) {
    case SectionType.HERO:
      return (
        <>
          <label className={labelClass}>
            Baslik
            <input name="headline" defaultValue={asString(f.headline)} className={inputClass} />
          </label>
          <label className={labelClass}>
            Alt baslik
            <textarea name="subheadline" defaultValue={asString(f.subheadline)} rows={2} className={inputClass} />
          </label>
          <label className={labelClass}>
            Buton metni
            <input name="ctaText" defaultValue={asString(f.ctaText)} className={inputClass} />
          </label>
        </>
      );
    case SectionType.CTA:
      return (
        <>
          <label className={labelClass}>
            Baslik
            <input name="headline" defaultValue={asString(f.headline)} className={inputClass} />
          </label>
          <label className={labelClass}>
            Alt baslik
            <textarea name="subheadline" defaultValue={asString(f.subheadline)} rows={2} className={inputClass} />
          </label>
          <label className={labelClass}>
            Buton metni
            <input name="buttonText" defaultValue={asString(f.buttonText)} className={inputClass} />
          </label>
        </>
      );
    case SectionType.CUSTOM:
      return (
        <>
          <label className={labelClass}>
            Baslik
            <input name="title" defaultValue={asString(f.title)} className={inputClass} />
          </label>
          <label className={labelClass}>
            Icerik
            <textarea name="body" defaultValue={asString(f.body)} rows={3} className={inputClass} />
          </label>
        </>
      );
    case SectionType.FEATURES:
      return (
        <>
          <label className={labelClass}>
            Baslik
            <input name="title" defaultValue={asString(f.title)} className={inputClass} />
          </label>
          <ItemRows
            prefix="items"
            minCount={SECTION_ROW_COUNTS.FEATURES}
            items={asArray(f.items)}
            columns={[
              { key: "title", placeholder: "Ozellik basligi" },
              { key: "description", placeholder: "Aciklama" },
            ]}
          />
        </>
      );
    case SectionType.TESTIMONIALS:
      return (
        <>
          <label className={labelClass}>
            Baslik
            <input name="title" defaultValue={asString(f.title)} className={inputClass} />
          </label>
          <ItemRows
            prefix="items"
            minCount={SECTION_ROW_COUNTS.TESTIMONIALS}
            items={asArray(f.items)}
            columns={[
              { key: "quote", placeholder: "Alinti", multiline: true },
              { key: "author", placeholder: "Isim" },
              { key: "role", placeholder: "Unvan" },
            ]}
          />
        </>
      );
    case SectionType.FAQ:
      return (
        <>
          <label className={labelClass}>
            Baslik
            <input name="title" defaultValue={asString(f.title)} className={inputClass} />
          </label>
          <ItemRows
            prefix="items"
            minCount={SECTION_ROW_COUNTS.FAQ}
            items={asArray(f.items)}
            columns={[
              { key: "question", placeholder: "Soru" },
              { key: "answer", placeholder: "Cevap", multiline: true },
            ]}
          />
        </>
      );
    case SectionType.FOOTER:
      return (
        <>
          <label className={labelClass}>
            Metin
            <textarea name="text" defaultValue={asString(f.text)} rows={2} className={inputClass} />
          </label>
          <ItemRows
            prefix="links"
            minCount={SECTION_ROW_COUNTS.FOOTER}
            items={asArray(f.links)}
            columns={[
              { key: "label", placeholder: "Link metni" },
              { key: "href", placeholder: "https://... veya /yol" },
            ]}
          />
        </>
      );
    case SectionType.PRICING: {
      const plans = asArray(f.plans);
      const rowCount = Math.max(SECTION_ROW_COUNTS.PRICING, plans.length);
      return (
        <>
          <label className={labelClass}>
            Baslik
            <input name="title" defaultValue={asString(f.title)} className={inputClass} />
          </label>
          <div className="flex flex-col gap-3">
            {Array.from({ length: rowCount }).map((_, i) => {
              const plan = plans[i];
              const features = Array.isArray(plan?.features)
                ? (plan.features as unknown[]).filter((x) => typeof x === "string").join("\n")
                : "";
              return (
                <div key={i} className="grid grid-cols-2 gap-2">
                  <input
                    name={`plans.${i}.name`}
                    placeholder="Plan adi"
                    defaultValue={asString(plan?.name)}
                    className={inputClass}
                  />
                  <input
                    name={`plans.${i}.price`}
                    placeholder="Fiyat"
                    defaultValue={asString(plan?.price)}
                    className={inputClass}
                  />
                  <textarea
                    name={`plans.${i}.features`}
                    placeholder={"Ozellikler (her satira bir tane)"}
                    defaultValue={features}
                    rows={2}
                    className={`${inputClass} col-span-2`}
                  />
                </div>
              );
            })}
          </div>
        </>
      );
    }
  }
}
