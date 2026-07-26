import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { canAcceptInvite, getInviteAcceptPath } from "@/features/team/invites";
import { getUser } from "@/lib/auth";
import { ROUTES } from "@/lib/constants";
import { prisma } from "@/lib/prisma";

import { InviteAcceptClient } from "./invite-accept-client";

export const metadata: Metadata = { title: "Accept invite — CEVORYN" };

interface InvitePageProps {
  params: Promise<{ token: string }>;
}

export default async function InvitePage({ params }: InvitePageProps) {
  const { token } = await params;
  const acceptPath = getInviteAcceptPath(token);
  const user = await getUser();

  if (!user) {
    redirect(`${ROUTES.LOGIN}?next=${encodeURIComponent(acceptPath)}`);
  }

  const invite = await prisma.invite.findUnique({
    where: { token },
    include: {
      organization: { select: { name: true } },
    },
  });

  if (!invite) {
    return (
      <InviteResult
        title="Invite not found"
        message="Ask your workspace admin to send a new invite."
      />
    );
  }

  const eligibility = canAcceptInvite({
    inviteEmail: invite.email,
    userEmail: user.email,
    status: invite.status,
    expiresAt: invite.expiresAt,
  });

  if (!eligibility.ok) {
    if (
      invite.status === "PENDING" &&
      invite.expiresAt.getTime() <= Date.now()
    ) {
      await prisma.invite.update({
        where: { id: invite.id },
        data: { status: "EXPIRED" },
      });
    }

    return (
      <InviteResult title="Invite unavailable" message={eligibility.message} />
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Join {invite.organization.name}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            You were invited as {invite.role.toLowerCase()}. Confirm below to add
            this workspace to your CEVORYN account.
          </p>
          <InviteAcceptClient
            token={token}
            organizationName={invite.organization.name}
          />
          <Button asChild variant="outline" className="w-full">
            <Link href={ROUTES.DASHBOARD}>Cancel</Link>
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}

function InviteResult({
  title,
  message,
  actionHref = ROUTES.LOGIN,
  actionLabel = "Back to sign in",
}: {
  title: string;
  message: string;
  actionHref?: string;
  actionLabel?: string;
}) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>{title}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">{message}</p>
          <Button asChild className="w-full">
            <Link href={actionHref}>{actionLabel}</Link>
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
