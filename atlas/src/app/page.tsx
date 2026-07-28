import { ArrowRight } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { BRAND } from "@/lib/brand";
import { ROUTES } from "@/lib/constants";

export default function HomePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-4">
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

      <footer className="mt-16 flex gap-4 text-sm text-muted-foreground">
        <Link className="hover:text-foreground" href={ROUTES.TERMS}>
          Terms
        </Link>
        <Link className="hover:text-foreground" href={ROUTES.PRIVACY}>
          Privacy
        </Link>
        <Link className="hover:text-foreground" href={ROUTES.REFUNDS}>
          Refunds
        </Link>
      </footer>
    </main>
  );
}
