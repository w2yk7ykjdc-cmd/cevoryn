import { requireActiveOrganization } from "@/server/auth/session";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { OrganizationSettingsForm } from "@/app/(dashboard)/dashboard/settings/organization-settings-form";
import { DangerZone } from "@/app/(dashboard)/dashboard/settings/danger-zone";

export default async function SettingsPage() {
  const { organization, member } = await requireActiveOrganization();
  const isOwner = member.role.split(",").includes("owner");

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">Workspace configuration.</p>
      </div>

      <Card className="max-w-lg">
        <CardHeader>
          <CardTitle className="text-base">General</CardTitle>
          <CardDescription>
            Slug: <code>{organization.slug}</code> (immutable in Sprint 0)
          </CardDescription>
        </CardHeader>
        <CardContent>
          <OrganizationSettingsForm initialName={organization.name} />
        </CardContent>
      </Card>

      <DangerZone organizationSlug={organization.slug} isOwner={isOwner} />
    </div>
  );
}
