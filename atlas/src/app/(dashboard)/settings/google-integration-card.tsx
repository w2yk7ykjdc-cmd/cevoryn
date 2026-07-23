"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

export function GoogleIntegrationCard({
  connectedEmail,
}: {
  connectedEmail: string | null;
}) {
  const router = useRouter();
  const [disconnecting, setDisconnecting] = useState(false);

  async function disconnect() {
    setDisconnecting(true);
    try {
      const response = await fetch("/api/integrations/google/disconnect", {
        method: "DELETE",
      });
      if (!response.ok) throw new Error("Disconnect failed");
      toast.success("Google account disconnected");
      router.refresh();
    } catch {
      toast.error("Google account could not be disconnected");
    } finally {
      setDisconnecting(false);
    }
  }

  if (!connectedEmail) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Connect Gmail and Google Calendar so Atlas can create drafts and calendar events after your approval.
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
        {disconnecting ? "Disconnecting..." : "Disconnect"}
      </Button>
    </div>
  );
}
