"use client";

import { useState } from "react";
import { toast } from "sonner";
import { updateOrganizationAction } from "@/app/(dashboard)/dashboard/settings/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function OrganizationSettingsForm({ initialName }: { initialName: string }) {
  const [name, setName] = useState(initialName);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setIsSubmitting(true);
    const result = await updateOrganizationAction(name);
    setIsSubmitting(false);

    if (!result.success) toast.error(result.error);
    else toast.success("Workspace updated");
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <div className="flex flex-col gap-2">
        <Label htmlFor="org-name">Workspace name</Label>
        <Input id="org-name" required value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <Button type="submit" disabled={isSubmitting || name.trim() === initialName} className="w-fit">
        {isSubmitting ? "Saving…" : "Save changes"}
      </Button>
    </form>
  );
}
