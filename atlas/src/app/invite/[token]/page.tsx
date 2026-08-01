import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

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
  const t = await getTranslations("invite");

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
        title={t("notFoundTitle")}
        message={t("notFoundMessage")}
        backToSignIn={t("backToSignIn")}
      />
    );
  }

  const eligibility = canAcceptInvite(
    {
      inviteEmail: invite.email,
      userEmail: user.email,
      status: invite.status,
      expiresAt: invite.expiresAt,
    },
    await getTranslations("invite.errors")
  );

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
      <InviteResult
        title={t("unavailableTitle")}
        message={eligibility.message}
        backToSignIn={t("backToSignIn")}
      />
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>
            {t("join", { orgName: invite.organization.name })}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            {t("invitedAs", { role: invite.role.toLowerCase() })}
          </p>
          <InviteAcceptClient
            token={token}
            organizationName={invite.organization.name}
          />
          <Button asChild variant="outline" className="w-full">
            <Link href={ROUTES.DASHBOARD}>{t("cancel")}</Link>
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
  backToSignIn,
}: {
  title: string;
  message: string;
  actionHref?: string;
  backToSignIn: string;
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
            <Link href={actionHref}>{backToSignIn}</Link>
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
