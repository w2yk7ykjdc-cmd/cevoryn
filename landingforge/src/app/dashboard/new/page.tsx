import Link from "next/link";
import { requireUser } from "@/lib/get-current-user";
import { THEME_PRESETS } from "@/lib/theme-presets";
import { createProjectFromBrief } from "./actions";

export default async function NewProjectWizardPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  await requireUser();
  const { error } = await searchParams;

  return (
    <div className="mx-auto flex min-h-screen max-w-xl flex-col gap-6 px-4 py-10">
      <div>
        <Link href="/dashboard" className="text-sm text-gray-500 hover:underline">
          &larr; Projeler
        </Link>
        <h1 className="text-2xl font-semibold">
          Isini anlat, sayfani biz yayinlayalim
        </h1>
        <p className="text-sm text-gray-500">
          Tek formu doldur, birkaç dakika icinde canli bir landing page&apos;in olsun.
        </p>
      </div>

      {error && (
        <p className="rounded bg-red-50 p-3 text-sm text-red-700">{error}</p>
      )}

      <form className="flex flex-col gap-4">
        <label className="flex flex-col gap-1 text-sm">
          Isini/urununu anlat
          <textarea
            name="businessDescription"
            required
            rows={4}
            placeholder="Orn: Kucuk isletmeler icin muhasebe otomasyonu yapan bir SaaS urunu."
            className="rounded border px-3 py-2 text-sm"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          Hedef kitle (opsiyonel)
          <input
            name="targetAudience"
            placeholder="Orn: 1-10 kisilik muhasebe ofisleri"
            className="rounded border px-3 py-2 text-sm"
          />
        </label>

        <fieldset className="flex flex-col gap-2 text-sm">
          <legend className="mb-1 font-medium">Tema</legend>
          <div className="grid grid-cols-2 gap-2">
            {THEME_PRESETS.map((preset, i) => (
              <label
                key={preset.id}
                className="flex cursor-pointer items-center gap-2 rounded border px-3 py-2"
              >
                <input
                  type="radio"
                  name="themePreset"
                  value={preset.id}
                  defaultChecked={i === 0}
                />
                <span
                  className="h-4 w-4 rounded-full border"
                  style={{ backgroundColor: preset.primaryColor }}
                />
                {preset.label}
              </label>
            ))}
          </div>
        </fieldset>

        <button
          formAction={createProjectFromBrief}
          className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          Sayfami olustur ve yayinla
        </button>
      </form>
    </div>
  );
}
