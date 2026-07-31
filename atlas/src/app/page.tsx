import {
  ArrowRight,
  CheckSquare,
  Gauge,
  MessageSquare,
  Scale,
  Sunrise,
  Users,
} from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { BRAND } from "@/lib/brand";
import { ROUTES } from "@/lib/constants";

const FEATURES = [
  {
    icon: MessageSquare,
    title: "AI chat with workspace context",
    description:
      "Ask about priorities, plans, or risks. Answers are grounded in your team's activity and connected Google Calendar/Gmail signals, not generic advice.",
  },
  {
    icon: Scale,
    title: "Decision support",
    description:
      "Log a decision, get a structured recommendation, and track the outcome afterward so the next decision gets sharper.",
  },
  {
    icon: CheckSquare,
    title: "Prepared actions",
    description:
      "Review AI-drafted next steps in a queue and approve or dismiss them — nothing happens on your behalf without a click.",
  },
  {
    icon: Sunrise,
    title: "Morning brief",
    description:
      "A short daily summary of what changed and what needs attention, built from your workspace's real activity.",
  },
  {
    icon: Gauge,
    title: "Company Pulse",
    description:
      "A live engagement score across conversations, response time, and team coverage, with the contributing factors shown.",
  },
  {
    icon: Users,
    title: "Team collaboration",
    description:
      "Invite your team with role-based access. Everyone works from the same workspace context.",
  },
] as const;

export default function HomePage() {
  return (
    <main className="flex min-h-screen flex-col items-center px-4 py-16">
      <div className="mx-auto max-w-2xl text-center">
        <div className="mb-6 inline-flex items-center rounded-full border px-4 py-1.5 text-sm text-muted-foreground">
          {BRAND.description}
        </div>
        <h1 className="text-balance text-4xl font-bold tracking-tight sm:text-5xl">
          {BRAND.name}
        </h1>
        <p className="mt-4 text-lg text-muted-foreground">
          The operations layer your team needs. Decisions, priorities, and
          execution — powered by AI, built for teams of 2–20.
        </p>
        <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
          <Link href={ROUTES.SIGNUP}>
            <Button size="lg">
              Get started
              <ArrowRight />
            </Button>
          </Link>
          <Link href={ROUTES.LOGIN}>
            <Button variant="outline" size="lg">
              Sign in
            </Button>
          </Link>
        </div>
      </div>

      <div className="mx-auto mt-20 grid max-w-4xl gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {FEATURES.map((feature) => (
          <div key={feature.title} className="rounded-lg border p-5 text-left">
            <feature.icon className="h-6 w-6 text-primary" />
            <h2 className="mt-3 font-semibold">{feature.title}</h2>
            <p className="mt-1.5 text-sm text-muted-foreground">
              {feature.description}
            </p>
          </div>
        ))}
      </div>

      <footer className="mt-16 flex flex-col items-center gap-3 text-sm text-muted-foreground">
        <div className="flex gap-4">
          <Link className="hover:text-foreground" href={ROUTES.TERMS}>
            Terms
          </Link>
          <Link className="hover:text-foreground" href={ROUTES.PRIVACY}>
            Privacy
          </Link>
          <Link className="hover:text-foreground" href={ROUTES.REFUNDS}>
            Refunds
          </Link>
        </div>
        <p className="text-xs">
          © {new Date().getFullYear()} {BRAND.name}. All rights reserved.
        </p>
      </footer>
    </main>
  );
}
