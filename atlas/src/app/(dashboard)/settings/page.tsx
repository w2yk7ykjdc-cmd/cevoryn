import { Building2, CreditCard, Link2, Shield, ShieldAlert } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { requireMembership, requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hasPermission } from "@/lib/rbac";

import { GoogleIntegrationCard } from "./google-integration-card";
import { OrganizationNameForm } from "./organization-name-form";
import { TestDataCleanup } from "./test-data-cleanup";

export const metadata: Metadata = { title: "Settings — CEVORYN" };

type GoogleConnectionSummary = {
  google_email: string;
};

function isGoogleIntegrationConfigured(): boolean {
  return Boolean(
    process.env.GOOGLE_CLIENT_ID?.trim() &&
      process.env.GOOGLE_CLIENT_SECRET?.trim() &&
      process.env.GOOGLE_TOKEN_ENCRYPTION_KEY?.trim() &&
      (process.env.NEXT_PUBLIC_APP_URL?.trim() ||
        process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim())
  );
}

async function getConnectedGoogleEmail(
  organizationId: string,
  userId: string,
  configured: boolean
): Promise<string | null> {
  if (!configured) return null;

  try {
    const rows = await prisma.$queryRaw<GoogleConnectionSummary[]>`
      SELECT "google_email"
      FROM "google_connections"
      WHERE "organization_id" = ${organizationId}
        AND "user_id" = ${userId}
      LIMIT 1
    `;

    return rows[0]?.google_email ?? null;
  } catch (error) {
    console.error(
      "[cevoryn:google] connection status unavailable",
      error instanceof Error ? error.message : "unknown"
    );
    return null;
  }
}

export default async function SettingsPage() {
  const user = await requireUser();
  const membership = await requireMembership(user.id);
  const googleConfigured = isGoogleIntegrationConfigured();

  const [org, memberCount, memoryCount, conversationCount, connectedGoogleEmail] =
    await Promise.all([
      prisma.organization.findUnique({
        where: { id: membership.organizationId },
        select: { name: true, slug: true, createdAt: true },
      }),
      prisma.member.count({ where: { organizationId: membership.organizationId } }),
      prisma.memory.count({
        where: { organizationId: membership.organizationId, isActive: true },
      }),
      prisma.conversation.count({
        where: { organizationId: membership.organizationId },
      }),
      getConnectedGoogleEmail(
        membership.organizationId,
        user.id,
        googleConfigured
      ),
    ]);

  if (!org) return null;

  const canUpdateOrganization = hasPermission(membership.role, "org:update");

  return (
    <div className="mx-auto max-w-2xl space-y-6 pb-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">Manage your workspace</p>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Building2 className="h-4 w-4" />
            Organization
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {canUpdateOrganization ? (
            <div className="space-y-2">
              <span className="text-sm text-muted-foreground">Name</span>
              <OrganizationNameForm initialName={org.name} />
            </div>
          ) : (
            <Row label="Name" value={org.name} />
          )}
          <Separator />
          <Row label="Slug" value={org.slug} />
          <Separator />
          <Row
            label="Created"
            value={new Intl.DateTimeFormat("en-US", {
              dateStyle: "long",
            }).format(org.createdAt)}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <CreditCard className="h-4 w-4" />
            Billing
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Link
            href="/settings/billing"
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            Manage billing
          </Link>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Link2 className="h-4 w-4" />
            Integrations
          </CardTitle>
        </CardHeader>
        <CardContent>
          <GoogleIntegrationCard
            connectedEmail={connectedGoogleEmail}
            configured={googleConfigured}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Shield className="h-4 w-4" />
            Your account
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Row label="Name" value={membership.displayName} />
          <Separator />
          <Row
            label="Role"
            value={
              <Badge variant="secondary" className="text-xs">
                {membership.role}
              </Badge>
            }
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Workspace usage</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-4 text-center">
            <div>
              <p className="text-2xl font-bold">{memberCount}</p>
              <p className="text-xs text-muted-foreground">Members</p>
            </div>
            <div>
              <p className="text-2xl font-bold">{conversationCount}</p>
              <p className="text-xs text-muted-foreground">Conversations</p>
            </div>
            <div>
              <p className="text-2xl font-bold">{memoryCount}</p>
              <p className="text-xs text-muted-foreground">Memories</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {membership.role === "OWNER" ? (
        <Card className="border-destructive/30">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldAlert className="h-4 w-4" />
              Beta maintenance
            </CardTitle>
          </CardHeader>
          <CardContent>
            <TestDataCleanup />
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-sm font-medium">{value}</span>
    </div>
  );
}
