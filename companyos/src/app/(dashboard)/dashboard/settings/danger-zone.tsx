"use client";

import { useState } from "react";
import { toast } from "sonner";
import { deleteAccountAction, deleteOrganizationAction } from "@/app/(dashboard)/dashboard/settings/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export function DangerZone({ organizationSlug, isOwner }: { organizationSlug: string; isOwner: boolean }) {
  return (
    <Card className="max-w-lg border-destructive/50">
      <CardHeader>
        <CardTitle className="text-base text-destructive">Danger zone</CardTitle>
        <CardDescription>These actions are permanent and cannot be undone.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        {isOwner && <DeleteWorkspaceForm organizationSlug={organizationSlug} />}
        <DeleteAccountForm />
      </CardContent>
    </Card>
  );
}

function DeleteWorkspaceForm({ organizationSlug }: { organizationSlug: string }) {
  const [confirmation, setConfirmation] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setIsSubmitting(true);
    const result = await deleteOrganizationAction(confirmation);
    setIsSubmitting(false);
    if (!result.success) toast.error(result.error);
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-2 border-b pb-6">
      <p className="text-sm font-medium">Delete this workspace</p>
      <p className="text-sm text-muted-foreground">
        Permanently deletes every company, contact, lead, task, and conversation in this workspace, and cancels any
        active subscription. Type <code>{organizationSlug}</code> to confirm.
      </p>
      <Label htmlFor="org-delete-confirm" className="sr-only">
        Workspace slug
      </Label>
      <Input
        id="org-delete-confirm"
        value={confirmation}
        onChange={(e) => setConfirmation(e.target.value)}
        placeholder={organizationSlug}
        className="max-w-xs"
      />
      <Button
        type="submit"
        variant="destructive"
        disabled={isSubmitting || confirmation !== organizationSlug}
        className="w-fit"
      >
        {isSubmitting ? "Deleting…" : "Delete workspace"}
      </Button>
    </form>
  );
}

function DeleteAccountForm() {
  const [confirmation, setConfirmation] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setIsSubmitting(true);
    const result = await deleteAccountAction();
    setIsSubmitting(false);
    if (!result.success) toast.error(result.error);
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-2">
      <p className="text-sm font-medium">Delete your account</p>
      <p className="text-sm text-muted-foreground">
        Permanently deletes your login. Anything you created stays with the workspace. Type <code>DELETE</code> to
        confirm.
      </p>
      <Label htmlFor="account-delete-confirm" className="sr-only">
        Confirmation
      </Label>
      <Input
        id="account-delete-confirm"
        value={confirmation}
        onChange={(e) => setConfirmation(e.target.value)}
        placeholder="DELETE"
        className="max-w-xs"
      />
      <Button type="submit" variant="destructive" disabled={isSubmitting || confirmation !== "DELETE"} className="w-fit">
        {isSubmitting ? "Deleting…" : "Delete account"}
      </Button>
    </form>
  );
}
