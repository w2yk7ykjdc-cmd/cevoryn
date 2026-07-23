"use client";

import { AlertTriangle, RotateCcw } from "lucide-react";
import { useEffect } from "react";

import { Button } from "@/components/ui/button";

export default function ChatError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Chat error:", error);
  }, [error]);

  return (
    <div className="flex h-full min-h-[60vh] flex-col items-center justify-center px-6 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-destructive/10">
        <AlertTriangle className="h-7 w-7 text-destructive" />
      </div>

      <h1 className="mt-5 text-xl font-semibold">Conversation could not load</h1>
      <p className="mt-2 max-w-sm text-sm text-muted-foreground">
        Atlas encountered a temporary problem while opening this conversation. Your saved messages are safe.
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
