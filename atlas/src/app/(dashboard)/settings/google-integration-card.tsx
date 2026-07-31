"use client";

import { Loader2 } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
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
  const t = useTranslations("settings.google");
  const router = useRouter();
  const searchParams = useSearchParams();
  const [disconnecting, setDisconnecting] = useState(false);
  const [creatingDraft, setCreatingDraft] = useState(false);
  const [confirmingDraft, setConfirmingDraft] = useState(false);

  useEffect(() => {
    const status = searchParams.get("google");
    if (status === "connected") toast.success(t("connectedToast"));
    if (status === "error") toast.error(t("connectErrorToast"));

    if (status) {
      router.replace("/settings", { scroll: false });
    }
  }, [router, searchParams, t]);

  async function createTestDraft() {
    if (!connectedEmail) return;

    setConfirmingDraft(false);
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
        }
      );

      if (handleUnauthorized(response)) return;

      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.error?.message ?? t("draftCreateFailed"));
      }

      toast.success(t("draftCreated"));
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t("draftCreateFailed")
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
        throw new Error(payload?.error?.message ?? t("disconnectFailed"));
      }

      toast.success(t("disconnected"));
      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t("disconnectFailed")
      );
    } finally {
      setDisconnecting(false);
    }
  }

  if (!configured) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">{t("notConfigured")}</p>
        <Button disabled>{t("connectButton")}</Button>
      </div>
    );
  }

  if (!connectedEmail) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          {t("notConnectedDescription")}
        </p>
        <Button asChild>
          <a href="/api/integrations/google/connect">{t("connectButton")}</a>
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div>
        <p className="text-sm font-medium">{t("connected")}</p>
        <p className="text-sm text-muted-foreground">{connectedEmail}</p>
      </div>
      {confirmingDraft ? (
        <div className="space-y-2 rounded-md border p-3">
          <p className="text-sm text-muted-foreground">
            {t("confirmDraft", { email: connectedEmail })}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              onClick={createTestDraft}
              disabled={creatingDraft}
            >
              {creatingDraft && <Loader2 className="h-4 w-4 animate-spin" />}
              {creatingDraft ? t("creatingDraft") : t("createDraft")}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setConfirmingDraft(false)}
              disabled={creatingDraft}
            >
              {t("cancel")}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button
            onClick={() => setConfirmingDraft(true)}
            disabled={disconnecting}
          >
            {t("createTestDraft")}
          </Button>
          <Button
            variant="outline"
            onClick={disconnect}
            disabled={disconnecting}
          >
            {disconnecting && <Loader2 className="h-4 w-4 animate-spin" />}
            {disconnecting ? t("disconnecting") : t("disconnect")}
          </Button>
        </div>
      )}
    </div>
  );
}
