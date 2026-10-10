import { ArrowRight, BookOpen, Crown, Heart, Sparkles } from "lucide-react";
import Link from "next/link";

interface LibraryUniverse {
  slug: string;
  name: string;
  description: string;
}

interface StoryLibraryGridProps {
  universes: LibraryUniverse[];
}

/** Content-driven - every story card comes from a published Universe row. */
export function StoryLibraryGrid({ universes }: StoryLibraryGridProps) {
  return (
    <div className="space-y-14 pb-8 sm:space-y-20">
      <section className="relative isolate overflow-hidden rounded-[2rem] border border-[#e9a0c4]/20 bg-[#160b20]/80 shadow-[0_30px_100px_rgba(0,0,0,0.32)]">
        <div
          aria-hidden="true"
          className="absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_76%_20%,rgba(239,123,169,0.32),transparent_30%),radial-gradient(ellipse_at_82%_74%,rgba(130,66,202,0.3),transparent_38%),linear-gradient(115deg,#100817_8%,#28102c_58%,#180d25_100%)]"
        />
        <div aria-hidden="true" className="absolute -right-20 -top-24 -z-10 h-80 w-80 rounded-full border border-[#f7d18a]/15 sm:h-[28rem] sm:w-[28rem]" />
        <div aria-hidden="true" className="absolute -right-10 top-10 -z-10 h-64 w-64 rounded-full border border-[#f7d18a]/10 sm:h-80 sm:w-80" />
        <div className="grid min-h-[30rem] items-center gap-8 px-6 py-12 sm:px-10 sm:py-16 lg:min-h-[34rem] lg:grid-cols-[1.05fr_0.95fr] lg:px-14">
          <div className="max-w-2xl">
            <p className="mb-5 text-[0.68rem] font-semibold uppercase tracking-[0.32em] text-[#f4c978]">
              Fantasy · Romance · Your story
            </p>
            <h1 className="max-w-xl font-serif text-5xl leading-[0.98] tracking-[-0.045em] text-[#fff4e8] sm:text-6xl lg:text-7xl">
              Where <span className="italic text-[#f28bb5]">desire</span> meets destiny.
            </h1>
            <p className="mt-6 max-w-lg text-base leading-7 text-[#d5c4dc] sm:text-lg sm:leading-8">
              Step into Thornbound — a world of forbidden courts, powerful beings,
              and choices that change everything. Every story is yours to shape.
            </p>
            <a
              href="#featured-stories"
              className="mt-8 inline-flex min-h-14 items-center justify-center gap-3 rounded-full bg-gradient-to-r from-[#ff9a91] via-[#ed5ca9] to-[#8b42e8] px-7 py-3 text-base font-semibold text-white shadow-[0_8px_34px_rgba(205,73,177,0.32)] transition hover:-translate-y-0.5 hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#ffe0a0]"
            >
              Begin your story <ArrowRight className="h-5 w-5" aria-hidden="true" />
            </a>
            <p className="mt-4 text-xs text-[#aa96b8]">An immersive 18+ interactive fiction experience.</p>
          </div>
          <div className="relative mx-auto flex min-h-[18rem] w-full max-w-md items-center justify-center lg:min-h-[25rem]">
            <div aria-hidden="true" className="absolute inset-4 rounded-[48%] bg-[radial-gradient(ellipse_at_center,rgba(240,121,171,0.3),rgba(106,56,163,0.14)_45%,transparent_72%)] blur-xl" />
            <div aria-hidden="true" className="absolute inset-x-8 top-5 h-64 rounded-t-full border border-[#f6d38b]/35 bg-[linear-gradient(180deg,rgba(255,199,133,0.12),rgba(124,57,137,0.08)_55%,transparent)] sm:h-80" />
            <div aria-hidden="true" className="absolute bottom-8 left-1/2 h-28 w-[85%] -translate-x-1/2 rounded-[50%] border border-[#f6d38b]/25 bg-[radial-gradient(ellipse_at_center,rgba(236,126,166,0.18),transparent_70%)]" />
            <div className="relative mx-5 flex aspect-[4/5] w-[68%] max-w-[17rem] flex-col items-center justify-center overflow-hidden rounded-t-[48%] rounded-b-[1.5rem] border border-[#f3d28d]/35 bg-[linear-gradient(160deg,rgba(255,194,143,0.18),rgba(69,28,76,0.55)_42%,rgba(15,8,22,0.92))] px-6 text-center shadow-[0_25px_70px_rgba(0,0,0,0.45)]">
              <div aria-hidden="true" className="absolute inset-2 rounded-t-[48%] rounded-b-[1rem] border border-white/10" />
              <Sparkles className="h-9 w-9 text-[#f6d38b]" strokeWidth={1.3} aria-hidden="true" />
              <p className="mt-5 font-serif text-3xl leading-tight text-[#fff0d9]">A world<br />beyond the ordinary</p>
              <p className="mt-3 text-sm leading-6 text-[#d4bfdc]">Secrets in every shadow.<br />A choice behind every door.</p>
              <span aria-hidden="true" className="mt-6 h-px w-16 bg-gradient-to-r from-transparent via-[#f6d38b] to-transparent" />
            </div>
          </div>
        </div>
        <div className="grid grid-cols-2 border-t border-white/10 bg-black/15 sm:grid-cols-4">
          {[
            { Icon: BookOpen, title: "Immersive stories", copy: "Rich worlds, deep narratives" },
            { Icon: Heart, title: "Unique characters", copy: "Allies, rivals and more" },
            { Icon: Sparkles, title: "Your choices matter", copy: "Multiple paths, unique outcomes" },
            { Icon: Crown, title: "Cinematic experience", copy: "Romance with atmosphere" },
          ].map(({ Icon, title, copy }, index) => (
            <div key={title} className={`flex flex-col items-center px-3 py-6 text-center sm:py-7 ${index % 2 === 0 ? "border-r border-white/10" : ""} ${index < 2 ? "border-b border-white/10 sm:border-b-0" : ""} ${index === 1 ? "sm:border-r" : ""} ${index === 2 ? "sm:border-r" : ""} ${index === 3 ? "sm:border-r-0" : ""}`}>
              <Icon className="h-6 w-6 text-[#f4cb7c]" strokeWidth={1.5} aria-hidden="true" />
              <h2 className="mt-3 font-serif text-base text-[#fff0e5] sm:text-lg">{title}</h2>
              <p className="mt-1 max-w-40 text-xs leading-5 text-[#bcaac7]">{copy}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="featured-stories" className="scroll-mt-28">
        <div className="mb-7 flex flex-col gap-3 sm:mb-9 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-[0.68rem] font-semibold uppercase tracking-[0.3em] text-[#f4c978]">Featured stories</p>
            <h2 className="mt-2 font-serif text-3xl tracking-[-0.03em] text-[#fff2e8] sm:text-4xl">Discover new worlds</h2>
            <p className="mt-2 text-sm leading-6 text-[#bfaec9] sm:text-base">Love, power, betrayal. Which story will you choose?</p>
          </div>
          <span className="text-sm text-[#d8c0dc]">{universes.length} {universes.length === 1 ? "story" : "stories"} available</span>
        </div>

        {universes.length === 0 ? (
          <div className="rounded-2xl border border-white/10 bg-white/[0.035] px-6 py-12 text-center">
            <BookOpen className="mx-auto h-8 w-8 text-[#f4c978]" aria-hidden="true" />
            <p className="mt-4 font-serif text-xl text-[#fff2e8]">Your next world is on its way.</p>
            <p className="mt-2 text-sm text-[#bfaec9]">No stories are available yet. Check back soon.</p>
          </div>
        ) : (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {universes.map((universe, index) => (
              <Link
                key={universe.slug}
                href={`/romance/${universe.slug}`}
                className="group relative isolate flex min-h-80 flex-col overflow-hidden rounded-2xl border border-[#e9a0c4]/20 bg-[#160d20]/90 p-6 shadow-[0_16px_45px_rgba(0,0,0,0.18)] transition duration-300 hover:-translate-y-1 hover:border-[#f4c978]/50 hover:shadow-[0_22px_55px_rgba(116,46,120,0.2)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#f18ab7]"
              >
                <div aria-hidden="true" className={`absolute inset-0 -z-10 opacity-80 transition duration-300 group-hover:opacity-100 ${index % 3 === 0 ? "bg-[radial-gradient(ellipse_at_80%_0%,rgba(221,122,135,0.24),transparent_50%),linear-gradient(145deg,#29132d,#110a19_75%)]" : index % 3 === 1 ? "bg-[radial-gradient(ellipse_at_85%_5%,rgba(136,88,214,0.3),transparent_48%),linear-gradient(145deg,#201432,#110a19_75%)]" : "bg-[radial-gradient(ellipse_at_85%_5%,rgba(71,119,161,0.25),transparent_48%),linear-gradient(145deg,#142033,#110a19_75%)]"}`} />
                <div className="flex items-center justify-between">
                  <span className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-[#f4c978]/35 bg-black/15 text-[#f4c978]">
                    {index % 3 === 0 ? <Heart className="h-5 w-5" aria-hidden="true" /> : index % 3 === 1 ? <Sparkles className="h-5 w-5" aria-hidden="true" /> : <Crown className="h-5 w-5" aria-hidden="true" />}
                  </span>
                  <span className="text-[0.65rem] font-semibold uppercase tracking-[0.2em] text-[#d7bbd8]">Thornbound</span>
                </div>
                <div className="mt-auto pt-12">
                  <h3 className="font-serif text-2xl leading-tight text-[#fff0e5] group-hover:text-white">{universe.name}</h3>
                  <p className="mt-3 line-clamp-4 text-sm leading-6 text-[#c8b6d1]">{universe.description}</p>
                  <span className="mt-6 inline-flex min-h-11 items-center gap-2 rounded-full border border-[#f4c978]/35 bg-white/[0.035] px-4 text-sm font-medium text-[#ffe7b0] transition group-hover:border-[#f4c978]/70 group-hover:bg-[#f4c978]/10">
                    Enter story <ArrowRight className="h-4 w-4 transition group-hover:translate-x-1" aria-hidden="true" />
                  </span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>

      <section className="relative isolate overflow-hidden rounded-3xl border border-[#f4c978]/20 bg-[#170b20] px-6 py-10 sm:px-10 sm:py-14">
        <div aria-hidden="true" className="absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_85%_50%,rgba(209,91,149,0.24),transparent_40%),linear-gradient(100deg,rgba(22,9,29,0.98),rgba(42,16,48,0.82))]" />
        <p className="text-[0.68rem] font-semibold uppercase tracking-[0.3em] text-[#f4c978]">Your story awaits</p>
        <div className="mt-3 flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="max-w-2xl font-serif text-3xl leading-tight text-[#fff2e8] sm:text-4xl">Some choices change everything.</h2>
            <p className="mt-3 max-w-xl text-sm leading-6 text-[#c8b6d1] sm:text-base">Enter a world where every secret matters and every decision moves the story forward.</p>
          </div>
          <a href="#featured-stories" className="inline-flex min-h-12 shrink-0 items-center justify-center gap-2 self-start rounded-full bg-gradient-to-r from-[#ff9a91] via-[#ed5ca9] to-[#8b42e8] px-6 py-3 text-sm font-semibold text-white shadow-[0_8px_30px_rgba(205,73,177,0.24)] transition hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#ffe0a0] sm:self-auto">
            Explore stories <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </a>
        </div>
      </section>
    </div>
  );
}
