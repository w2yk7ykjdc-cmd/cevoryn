import { SectionType } from "@prisma/client";

type Fields = Record<string, unknown> | null | undefined;

export function SectionRenderer({ type, fields }: { type: SectionType; fields: Fields }) {
  if (!fields) return null;

  switch (type) {
    case SectionType.HERO: {
      const { headline, subheadline, ctaText } = fields as {
        headline: string;
        subheadline: string;
        ctaText: string;
      };
      return (
        <section className="flex flex-col items-center gap-4 px-4 py-24 text-center">
          <h1 className="text-4xl font-bold">{headline}</h1>
          <p className="max-w-xl text-lg opacity-80">{subheadline}</p>
          <button
            className="px-6 py-3 font-medium text-white"
            style={{ backgroundColor: "var(--primary)", borderRadius: "var(--radius)" }}
          >
            {ctaText}
          </button>
        </section>
      );
    }
    case SectionType.FEATURES: {
      const { title, items } = fields as {
        title: string;
        items: { title: string; description: string }[];
      };
      return (
        <section className="px-4 py-16">
          <h2 className="mb-8 text-center text-3xl font-semibold">{title}</h2>
          <div className="mx-auto grid max-w-4xl gap-6 sm:grid-cols-3">
            {items.map((item, i) => (
              <div key={i} className="border p-4" style={{ borderRadius: "var(--radius)" }}>
                <h3 className="font-medium">{item.title}</h3>
                <p className="text-sm opacity-70">{item.description}</p>
              </div>
            ))}
          </div>
        </section>
      );
    }
    case SectionType.PRICING: {
      const { title, plans } = fields as {
        title: string;
        plans: { name: string; price: string; features: string[] }[];
      };
      return (
        <section className="px-4 py-16">
          <h2 className="mb-8 text-center text-3xl font-semibold">{title}</h2>
          <div className="mx-auto grid max-w-4xl gap-6 sm:grid-cols-3">
            {plans.map((plan, i) => (
              <div key={i} className="border p-6" style={{ borderRadius: "var(--radius)" }}>
                <h3 className="text-xl font-medium">{plan.name}</h3>
                <p className="text-2xl font-bold" style={{ color: "var(--primary)" }}>
                  {plan.price}
                </p>
                <ul className="mt-4 flex flex-col gap-1 text-sm opacity-80">
                  {plan.features.map((feature, j) => (
                    <li key={j}>{feature}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
      );
    }
    case SectionType.TESTIMONIALS: {
      const { title, items } = fields as {
        title: string;
        items: { quote: string; author: string; role: string }[];
      };
      return (
        <section className="px-4 py-16">
          <h2 className="mb-8 text-center text-3xl font-semibold">{title}</h2>
          <div className="mx-auto grid max-w-4xl gap-6 sm:grid-cols-3">
            {items.map((item, i) => (
              <blockquote key={i} className="border p-4" style={{ borderRadius: "var(--radius)" }}>
                <p className="italic">&ldquo;{item.quote}&rdquo;</p>
                <footer className="mt-2 text-sm opacity-70">
                  {item.author}, {item.role}
                </footer>
              </blockquote>
            ))}
          </div>
        </section>
      );
    }
    case SectionType.CTA: {
      const { headline, subheadline, buttonText } = fields as {
        headline: string;
        subheadline: string;
        buttonText: string;
      };
      return (
        <section
          className="flex flex-col items-center gap-4 px-4 py-20 text-center text-white"
          style={{ backgroundColor: "var(--primary)" }}
        >
          <h2 className="text-3xl font-bold">{headline}</h2>
          <p className="max-w-xl opacity-90">{subheadline}</p>
          <button
            className="bg-white px-6 py-3 font-medium"
            style={{ color: "var(--primary)", borderRadius: "var(--radius)" }}
          >
            {buttonText}
          </button>
        </section>
      );
    }
    case SectionType.FAQ: {
      const { title, items } = fields as {
        title: string;
        items: { question: string; answer: string }[];
      };
      return (
        <section className="px-4 py-16">
          <h2 className="mb-8 text-center text-3xl font-semibold">{title}</h2>
          <div className="mx-auto flex max-w-2xl flex-col gap-4">
            {items.map((item, i) => (
              <div key={i}>
                <h3 className="font-medium">{item.question}</h3>
                <p className="text-sm opacity-70">{item.answer}</p>
              </div>
            ))}
          </div>
        </section>
      );
    }
    case SectionType.FOOTER: {
      const { text, links } = fields as {
        text: string;
        links: { label: string; href: string }[];
      };
      return (
        <footer className="flex flex-col items-center gap-2 border-t px-4 py-8 text-sm opacity-70">
          <p>{text}</p>
          <div className="flex gap-4">
            {links.map((link, i) => (
              <a key={i} href={link.href} className="hover:underline">
                {link.label}
              </a>
            ))}
          </div>
        </footer>
      );
    }
    case SectionType.CUSTOM: {
      const { title, body } = fields as { title: string; body: string };
      return (
        <section className="px-4 py-16">
          <h2 className="mb-4 text-2xl font-semibold">{title}</h2>
          <p className="opacity-80">{body}</p>
        </section>
      );
    }
    default:
      return null;
  }
}
