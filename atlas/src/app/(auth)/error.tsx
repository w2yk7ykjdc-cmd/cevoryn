"use client";

import { AlertTriangle, RotateCcw } from "lucide-react";
import { useEffect } from "react";

import { Button } from "@/components/ui/button";

export default function AuthError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Authentication page error:", error);
  }, [error]);

  return (
    <div className="flex w-full max-w-md flex-col items-center justify-center rounded-xl border bg-card px-6 py-12 text-center shadow-sm">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-destructive/10">
        <AlertTriangle className="h-7 w-7 text-destructive" />
      </div>
      <h1 className="mt-5 text-xl font-semibold">Sign-in page could not load</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        CEVORYN encountered a temporary authentication problem. Your account has not been changed.
      </p>
      {error.digest ? (
        <p className="mt-2 text-xs text-muted-foreground">Reference: {error.digest}</p>
      ) : null}
      <Button onClick={reset} className="mt-6">
        <RotateCcw className="h-4 w-4" />
        Try again
      </Button>
    </div>
  );
}
