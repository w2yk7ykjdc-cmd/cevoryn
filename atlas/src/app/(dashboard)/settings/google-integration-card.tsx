"use client";

import { Loader2 } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { handleUnauthorized } from "@/lib/client-auth";

export function GoogleIntegrationCard({
  connectedEmail,
}: {
  connectedEmail: string | null;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [disconnecting, setDisconnecting] = useState(false);

  useEffect(() => {
    const status = searchParams.get("google");
    if (status === "connected") toast.success("Google account connected");
    if (status === "error") toast.error("Google account could not be connected");

    if (status) {
      router.replace("/settings", { scroll: false });
    }
  }, [router, searchParams]);

  async function disconnect() {
    setDisconnecting(true);

    try {
      const response = await fetch("/api/integrations/google/disconnect", {
        method: "DELETE",
      });

      if (handleUnauthorized(response)) return;

      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(
          payload?.error?.message ?? "Google account could not be disconnected"
        );
      }

      toast.success("Google account disconnected");
      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Google account could not be disconnected"
      );
    } finally {
      setDisconnecting(false);
    }
  }

  if (!connectedEmail) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Connect Gmail and Google Calendar so Atlas can prepare email drafts and
          calendar actions for your approval.
        </p>
        <Button asChild>
          <a href="/api/integrations/google/connect">Connect Google</a>
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div>
        <p className="text-sm font-medium">Connected</p>
        <p className="text-sm text-muted-foreground">{connectedEmail}</p>
      </div>
      <Button variant="outline" onClick={disconnect} disabled={disconnecting}>
        {disconnecting && <Loader2 className="h-4 w-4 animate-spin" />}
        {disconnecting ? "Disconnecting..." : "Disconnect"}
      </Button>
    </div>
  );
}
