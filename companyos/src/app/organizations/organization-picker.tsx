"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

type Organization = { id: string; name: string; slug: string; role: string };

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

export function OrganizationPicker({ organizations }: { organizations: Organization[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [isSelecting, setIsSelecting] = useState<string | null>(null);

  async function selectOrganization(organizationId: string) {
    setIsSelecting(organizationId);
    const { error } = await authClient.organization.setActive({ organizationId });
    setIsSelecting(null);
    if (error) {
      toast.error(error.message ?? "Unable to switch workspace");
      return;
    }
    router.push("/dashboard");
    router.refresh();
  }

  async function handleCreate(event: React.FormEvent) {
    event.preventDefault();
    setIsCreating(true);

    const { data, error } = await authClient.organization.create({
      name,
      slug: slugify(name),
    });

    setIsCreating(false);
    if (error) {
      toast.error(error.message ?? "Unable to create workspace");
      return;
    }
    if (data) {
      await selectOrganization(data.id);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {organizations.length > 0 && (
        <div className="flex flex-col gap-2">
          {organizations.map((org) => (
            <button
              key={org.id}
              onClick={() => selectOrganization(org.id)}
              disabled={isSelecting !== null}
              className="flex items-center justify-between rounded-lg border bg-card p-4 text-left transition-colors hover:bg-accent disabled:opacity-50"
            >
              <div>
                <p className="font-medium">{org.name}</p>
                <p className="text-xs text-muted-foreground">{org.slug}</p>
              </div>
              <Badge variant="secondary" className="capitalize">
                {org.role}
              </Badge>
            </button>
          ))}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Create a new workspace</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleCreate} className="flex flex-col gap-3">
            <div className="flex flex-col gap-2">
              <Label htmlFor="org-name">Workspace name</Label>
              <Input
                id="org-name"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Acme Inc."
              />
            </div>
            <Button type="submit" disabled={isCreating || name.trim().length === 0}>
              {isCreating ? "Creating…" : "Create workspace"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
