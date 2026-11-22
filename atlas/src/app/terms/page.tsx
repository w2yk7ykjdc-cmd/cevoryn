import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Terms — CEVORYN" };

export default function TermsPage() {
  return (
    <main className="mx-auto max-w-3xl px-5 py-12 sm:py-16">
      <div className="space-y-8">
        <header className="space-y-2">
          <p className="text-muted-foreground text-sm">
            Last updated: July 22, 2026
          </p>
          <h1 className="text-3xl font-bold tracking-tight">Terms of use</h1>
          <p className="text-muted-foreground">
            These terms apply to use of CEVORYN.
          </p>
        </header>

        <LegalSection title="Service availability">
          CEVORYN is an actively developed product. Features may change, be
          interrupted, or be removed. The service may contain defects and should
          not be treated as the sole system of record for critical business
          operations.
        </LegalSection>

        <LegalSection title="Account responsibility">
          Users are responsible for maintaining account security, using accurate
          information, controlling team access, and reviewing actions before
          approving or carrying them out.
        </LegalSection>

        <LegalSection title="AI-generated content">
          CEVORYN can produce suggestions, summaries, decisions, drafts, and
          action plans using artificial intelligence. Outputs may be incomplete
          or incorrect. Users must review outputs and remain responsible for
          business, legal, financial, employment, medical, security, and
          operational decisions.
        </LegalSection>

        <LegalSection title="Acceptable use">
          CEVORYN may not be used to break the law, infringe rights, distribute
          malware, bypass security, impersonate others, process unlawfully
          obtained data, or create harmful automated actions.
        </LegalSection>

        <LegalSection title="User content">
          Users retain ownership of content they submit. Users grant CEVORYN the
          limited rights needed to host, process, secure, and display that
          content for operating and improving the service.
        </LegalSection>

        <LegalSection title="Third-party services">
          Some features depend on third-party providers such as hosting,
          authentication, AI, email, and calendar services. Their availability
          and terms may affect CEVORYN functionality.
        </LegalSection>

        <LegalSection title="No warranty">
          CEVORYN is provided on an “as is” and “as available” basis to the
          extent permitted by law, without guarantees of uninterrupted
          operation, accuracy, fitness for a particular purpose, or error-free
          results.
        </LegalSection>

        <LegalSection title="Suspension and termination">
          Access may be suspended or ended for security reasons, misuse, legal
          requirements, or prolonged inactivity. Users may stop using CEVORYN at
          any time.
        </LegalSection>

        <LegalSection title="Contact">
          Questions about these terms can be sent to kemalkiyak06@icloud.com.
        </LegalSection>

        <div className="text-muted-foreground border-t pt-6 text-sm">
          <Link className="underline underline-offset-4" href="/privacy">
            Privacy notice
          </Link>
          <span className="mx-2">·</span>
          <Link className="underline underline-offset-4" href="/refunds">
            Refund policy
          </Link>
          <span className="mx-2">·</span>
          <Link className="underline underline-offset-4" href="/">
            Back to CEVORYN
          </Link>
        </div>
      </div>
    </main>
  );
}

function LegalSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-2">
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="text-muted-foreground leading-7">{children}</p>
    </section>
  );
}
