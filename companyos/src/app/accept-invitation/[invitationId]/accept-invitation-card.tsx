"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export function AcceptInvitationCard({ invitationId }: { invitationId: string }) {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleAccept() {
    setIsSubmitting(true);
    const { data, error } = await authClient.organization.acceptInvitation({ invitationId });
    setIsSubmitting(false);

    if (error) {
      toast.error(error.message ?? "Unable to accept invitation");
      return;
    }

    if (data?.invitation.organizationId) {
      await authClient.organization.setActive({ organizationId: data.invitation.organizationId });
    }
    router.push("/dashboard");
    router.refresh();
  }

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle>Join workspace</CardTitle>
        <CardDescription>You&apos;ve been invited to join a CompanyOS workspace.</CardDescription>
      </CardHeader>
      <CardContent>
        <Button onClick={handleAccept} disabled={isSubmitting} className="w-full">
          {isSubmitting ? "Joining…" : "Accept invitation"}
        </Button>
      </CardContent>
    </Card>
  );
}
