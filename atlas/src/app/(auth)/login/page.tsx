import type { Metadata } from "next";

import { LoginForm } from "@/features/auth/components/login-form";
import { getSafeRedirectPath } from "@/lib/safe-redirect";

export const metadata: Metadata = { title: "Sign in" };

interface PageProps {
  searchParams: Promise<{
    next?: string;
    error?: string;
    reset?: string;
    reason?: string;
  }>;
}

export default async function LoginPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const redirectTo = params.next
    ? getSafeRedirectPath(params.next)
    : undefined;

  return (
    <LoginForm
      redirectTo={redirectTo}
      authError={params.error}
      passwordReset={params.reset === "success"}
      sessionExpired={params.reason === "session_expired"}
    />
  );
}
