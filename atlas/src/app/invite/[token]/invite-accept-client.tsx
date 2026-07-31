"use client";

import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { handleUnauthorized } from "@/lib/client-auth";

interface InviteAcceptClientProps {
  token: string;
  organizationName: string;
}

export function InviteAcceptClient({
  token,
  organizationName,
}: InviteAcceptClientProps) {
  const t = useTranslations("invite");
  const router = useRouter();
  const [isAccepting, setIsAccepting] = useState(false);

  async function acceptInvite() {
    setIsAccepting(true);

    try {
      const response = await fetch("/api/team/invite/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });

      if (handleUnauthorized(response)) return;

      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        toast.error(payload?.error?.message ?? t("acceptFailed"));
        return;
      }

      toast.success(
        t("joined", {
          orgName: payload?.data?.organizationName ?? organizationName,
        })
      );
      router.replace("/dashboard");
      router.refresh();
    } catch (_error) {
      toast.error(t("acceptFailed"));
    } finally {
      setIsAccepting(false);
    }
  }

  return (
    <Button className="w-full" disabled={isAccepting} onClick={acceptInvite}>
      {isAccepting && <Loader2 className="h-4 w-4 animate-spin" />}
      {t("acceptButton")}
    </Button>
  );
}
