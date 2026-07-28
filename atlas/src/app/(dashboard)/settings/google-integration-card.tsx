"use client";

import { Loader2 } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { handleUnauthorized } from "@/lib/client-auth";

export function GoogleIntegrationCard({
  connectedEmail,
  configured,
}: {
  connectedEmail: string | null;
  configured: boolean;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [disconnecting, setDisconnecting] = useState(false);
  const [creatingDraft, setCreatingDraft] = useState(false);

  useEffect(() => {
    const status = searchParams.get("google");
    if (status === "connected") toast.success("Google account connected");
    if (status === "error") toast.error("Google account could not be connected");

    if (status) {
      router.replace("/settings", { scroll: false });
    }
  }, [router, searchParams]);

  async function createTestDraft() {
    if (!connectedEmail) return;

    const approved = window.confirm(
      `Create a Gmail draft addressed to ${connectedEmail}? Nothing will be sent.`,
    );
    if (!approved) return;

    setCreatingDraft(true);

    try {
      const response = await fetch(
        "/api/integrations/google/actions/email-draft",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            approved: true,
            to: [connectedEmail],
            subject: "CEVORYN Google Test",
            body: "The Google connection is working successfully.",
          }),
        },
      );

      if (handleUnauthorized(response)) return;

      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(
          payload?.error?.message ?? "The Gmail draft could not be created",
        );
      }

      toast.success("Gmail test draft created");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "The Gmail draft could not be created",
      );
    } finally {
      setCreatingDraft(false);
    }
  }

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
          payload?.error?.message ?? "Google account could not be disconnected",
        );
      }

      toast.success("Google account disconnected");
      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Google account could not be disconnected",
      );
    } finally {
      setDisconnecting(false);
    }
  }

  if (!configured) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Google integration is not configured for this deployment yet.
        </p>
        <Button disabled>Connect Google</Button>
      </div>
    );
  }

  if (!connectedEmail) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Connect Gmail and Google Calendar so CEVORYN can prepare email drafts and
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
      <div className="flex flex-wrap gap-2">
        <Button onClick={createTestDraft} disabled={creatingDraft || disconnecting}>
          {creatingDraft && <Loader2 className="h-4 w-4 animate-spin" />}
          {creatingDraft ? "Creating draft..." : "Create Gmail test draft"}
        </Button>
        <Button variant="outline" onClick={disconnect} disabled={disconnecting}>
          {disconnecting && <Loader2 className="h-4 w-4 animate-spin" />}
          {disconnecting ? "Disconnecting..." : "Disconnect"}
        </Button>
      </div>
    </div>
  );
}
