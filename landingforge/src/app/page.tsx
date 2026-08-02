import Link from "next/link";

const FEATURES = [
  {
    title: "AI ile saniyeler icinde",
    description:
      "Isini kisaca anlat, AI senin icin baslik, ozellik ve CTA metinlerini yazip yayinlanmaya hazir bir sayfa olustursun.",
  },
  {
    title: "Kendi temanla yayinla",
    description:
      "Renk, font ve ozel CSS ile sayfani markana uydur, tek tikla yayina al.",
  },
  {
    title: "Kendi domaininde",
    description:
      "Sayfani landingforge alt yolunda ya da kendi domaininde, saniyeler icinde yayinla.",
  },
];

export default function Home() {
  return (
    <div className="flex flex-1 flex-col">
      <section className="mx-auto flex w-full max-w-3xl flex-1 flex-col items-center gap-6 px-4 py-24 text-center">
        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
          Isini anlat, landing page&apos;in AI ile saniyeler icinde yayinda olsun
        </h1>
        <p className="max-w-xl text-lg text-gray-500">
          LandingForge, urununu veya isini anlatan tek bir metinden; baslik,
          ozellikler, referanslar ve CTA icerikleriyle donatilmis, yayina hazir
          bir landing page uretir.
        </p>
        <div className="flex flex-col gap-3 sm:flex-row">
          <Link
            href="/login"
            className="rounded bg-blue-600 px-6 py-3 text-sm font-medium text-white hover:bg-blue-700"
          >
            Ucretsiz basla
          </Link>
          <Link
            href="/pricing"
            className="rounded border px-6 py-3 text-sm font-medium hover:bg-gray-50"
          >
            Fiyatlandirmayi gor
          </Link>
        </div>
      </section>

      <section className="mx-auto grid w-full max-w-4xl gap-6 px-4 pb-24 sm:grid-cols-3">
        {FEATURES.map((feature) => (
          <div key={feature.title} className="rounded-lg border p-6">
            <h2 className="font-medium">{feature.title}</h2>
            <p className="mt-2 text-sm text-gray-500">{feature.description}</p>
          </div>
        ))}
      </section>
    </div>
  );
}
