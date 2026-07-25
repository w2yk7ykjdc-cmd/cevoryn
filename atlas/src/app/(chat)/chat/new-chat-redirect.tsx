"use client";

import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { toast } from "sonner";

import { handleUnauthorized } from "@/lib/client-auth";

export function NewChatRedirect() {
  const router = useRouter();
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    let cancelled = false;

    async function createAndOpenConversation() {
      try {
        const response = await fetch("/api/conversations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        });

        if (cancelled || handleUnauthorized(response)) return;

        if (!response.ok) {
          const body = await response.json().catch(() => null);
          throw new Error(
            body?.error?.message ?? "Failed to create conversation"
          );
        }

        const payload = await response.json();
        if (!cancelled) {
          router.replace(`/chat/${payload.data.id}`);
        }
      } catch (error) {
        if (!cancelled) {
          toast.error(
            error instanceof Error ? error.message : "Something went wrong"
          );
          router.replace("/dashboard");
        }
      }
    }

    void createAndOpenConversation();

    return () => {
      cancelled = true;
    };
  }, [router]);

  return (
    <div className="flex h-full w-full items-center justify-center">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span>Opening a new conversation...</span>
      </div>
    </div>
  );
}
