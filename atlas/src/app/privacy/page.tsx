import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Privacy — CEVORYN" };

export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-3xl px-5 py-12 sm:py-16">
      <div className="space-y-8">
        <header className="space-y-2">
          <p className="text-sm text-muted-foreground">Last updated: July 22, 2026</p>
          <h1 className="text-3xl font-bold tracking-tight">Privacy notice</h1>
          <p className="text-muted-foreground">
            This notice explains how CEVORYN handles information during the private beta.
          </p>
        </header>

        <LegalSection title="Information CEVORYN processes">
          CEVORYN may process account details, organization and team information, chat content, decisions, prepared actions, product usage records, and technical diagnostic information needed to operate and secure the service.
        </LegalSection>

        <LegalSection title="How information is used">
          Information is used to provide CEVORYN features, maintain account security, improve reliability, respond to support requests, measure product performance, and prevent misuse. CEVORYN does not sell personal information.
        </LegalSection>

        <LegalSection title="AI processing">
          Content submitted to AI features may be sent to configured AI service providers to generate responses, briefs, insights, decisions, or action drafts. Users should not submit secrets, payment card data, health records, or other highly sensitive information unless a suitable agreement and configuration are in place.
        </LegalSection>

        <LegalSection title="Service providers">
          CEVORYN relies on infrastructure and service providers for hosting, authentication, databases, AI processing, monitoring, and email delivery. These providers process information only as needed to deliver their services under their own contractual and security obligations.
        </LegalSection>

        <LegalSection title="Retention and deletion">
          Information is retained while an account is active and as reasonably needed for security, legal, backup, and operational purposes. Beta users may request account or organization data deletion by contacting the CEVORYN team.
        </LegalSection>

        <LegalSection title="Security">
          CEVORYN uses access controls, organization isolation, authenticated routes, role-based permissions, and operational monitoring. No online service can guarantee absolute security.
        </LegalSection>

        <LegalSection title="Contact">
          Questions or deletion requests can be sent to kemalkiyak06@icloud.com.
        </LegalSection>

        <div className="border-t pt-6 text-sm text-muted-foreground">
          <Link className="underline underline-offset-4" href="/terms">Terms of use</Link>
          <span className="mx-2">·</span>
          <Link className="underline underline-offset-4" href="/refunds">Refund policy</Link>
          <span className="mx-2">·</span>
          <Link className="underline underline-offset-4" href="/">Back to CEVORYN</Link>
        </div>
      </div>
    </main>
  );
}

function LegalSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="leading-7 text-muted-foreground">{children}</p>
    </section>
  );
}
