import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Refund policy — CEVORYN" };

export default function RefundsPage() {
  return (
    <main className="mx-auto max-w-3xl px-5 py-12 sm:py-16">
      <div className="space-y-8">
        <header className="space-y-2">
          <p className="text-sm text-muted-foreground">
            Last updated: July 28, 2026
          </p>
          <h1 className="text-3xl font-bold tracking-tight">Refund policy</h1>
          <p className="text-muted-foreground">
            This policy applies to paid CEVORYN subscriptions.
          </p>
        </header>

        <LegalSection title="Subscription billing">
          Starter, Professional, and Business plans, and Thornbound Premium,
          are billed monthly in advance through our payment provider, Polar.
          Subscriptions renew automatically each billing period until
          cancelled.
        </LegalSection>

        <LegalSection title="Cancellations">
          Users can cancel their subscription at any time from the Billing
          page (or, for Thornbound Premium, the &quot;✦ Premium&quot; control
          in Thornbound&apos;s header). Cancelling stops future renewals;
          access continues until the end of the current paid period. We do
          not charge a cancellation fee.
        </LegalSection>

        <LegalSection title="Refund requests">
          If you believe you were charged in error, or are unsatisfied within
          the first 14 days of a new paid subscription, contact us and we will
          review the request. Approved refunds are issued to the original
          payment method through Polar.
        </LegalSection>

        <LegalSection title="Partial periods">
          We do not provide prorated refunds for unused time within a billing
          period when a subscription is cancelled or downgraded partway through.
        </LegalSection>

        <LegalSection title="Contact">
          Refund requests and billing questions can be sent to
          kemalkiyak06@icloud.com.
        </LegalSection>

        <div className="border-t pt-6 text-sm text-muted-foreground">
          <Link className="underline underline-offset-4" href="/terms">
            Terms of use
          </Link>
          <span className="mx-2">·</span>
          <Link className="underline underline-offset-4" href="/privacy">
            Privacy notice
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
      <p className="leading-7 text-muted-foreground">{children}</p>
    </section>
  );
}
