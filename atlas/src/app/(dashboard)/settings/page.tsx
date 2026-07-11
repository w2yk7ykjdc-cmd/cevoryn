import { Building2, Shield } from "lucide-react";
import type { Metadata } from "next";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { requireMembership, requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const metadata: Metadata = { title: "Settings — Atlas" };

export default async function SettingsPage() {
  const user = await requireUser();
  const membership = await requireMembership(user.id);

  const [org, memberCount, memoryCount, conversationCount] =
    await Promise.all([
      prisma.organization.findUnique({
        where: { id: membership.organizationId },
        select: { name: true, slug: true, createdAt: true },
      }),
      prisma.member.count({
        where: { organizationId: membership.organizationId },
      }),
      prisma.memory.count({
        where: { organizationId: membership.organizationId, isActive: true },
      }),
      prisma.conversation.count({
        where: { organizationId: membership.organizationId },
      }),
    ]);

  if (!org) return null;

  return (
    <div className="mx-auto max-w-2xl space-y-6 pb-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Manage your workspace
        </p>
      </div>

      {/* Organization */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Building2 className="h-4 w-4" />
            Organization
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Row label="Name" value={org.name} />
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

      {/* Your Role */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Shield className="h-4 w-4" />
            Your Account
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

      {/* Usage */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Workspace Usage</CardTitle>
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
    </div>
  );
}

function Row({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-sm font-medium">{value}</span>
    </div>
  );
}
