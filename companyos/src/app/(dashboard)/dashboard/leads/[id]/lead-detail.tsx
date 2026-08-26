"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import {
  addLeadNoteAction,
  changeLeadStageAction,
  deleteLeadAction,
  updateLeadAction,
} from "@/app/(dashboard)/dashboard/leads/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

type LeadDetailData = {
  id: string;
  title: string;
  value: number;
  probability: number;
  source: string | null;
  stageId: string;
  stage: { id: string; name: string };
  company: { id: string; name: string } | null;
  contact: { id: string; firstName: string; lastName: string } | null;
  owner: { id: string; name: string; email: string } | null;
  activities: {
    id: string;
    type: string;
    body: string | null;
    createdAt: Date;
    actor: { name: string } | null;
  }[];
  tasks: { id: string; title: string; status: string; dueDate: Date | null }[];
};

const NONE = "__none__";

export function LeadDetail({
  lead,
  stages,
  members,
}: {
  lead: LeadDetailData;
  stages: { id: string; name: string }[];
  members: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [title, setTitle] = useState(lead.title);
  const [value, setValue] = useState(String(lead.value));
  const [probability, setProbability] = useState(String(lead.probability));
  const [source, setSource] = useState(lead.source ?? "");
  const [ownerId, setOwnerId] = useState(lead.owner?.id ?? NONE);
  const [isSaving, setIsSaving] = useState(false);
  const [isChangingStage, setIsChangingStage] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [newNote, setNewNote] = useState("");
  const [isAddingNote, setIsAddingNote] = useState(false);

  async function handleSave(event: React.FormEvent) {
    event.preventDefault();
    setIsSaving(true);
    const result = await updateLeadAction(lead.id, {
      title,
      value: value ? Number(value) : undefined,
      probability: probability ? Number(probability) : undefined,
      source: source || null,
      ownerId: ownerId === NONE ? null : ownerId,
    });
    setIsSaving(false);
    if (!result.success) {
      toast.error(result.error);
      return;
    }
    toast.success("Lead updated");
    router.refresh();
  }

  async function handleStageChange(stageId: string) {
    setIsChangingStage(true);
    const result = await changeLeadStageAction(lead.id, stageId);
    setIsChangingStage(false);
    if (!result.success) {
      toast.error(result.error);
      return;
    }
    toast.success("Stage updated");
    router.refresh();
  }

  async function handleDelete() {
    setIsDeleting(true);
    const result = await deleteLeadAction(lead.id);
    setIsDeleting(false);
    if (!result.success) {
      toast.error(result.error);
      return;
    }
    toast.success("Lead deleted");
    router.push("/dashboard/leads");
    router.refresh();
  }

  async function handleAddNote(event: React.FormEvent) {
    event.preventDefault();
    if (!newNote.trim()) return;
    setIsAddingNote(true);
    const result = await addLeadNoteAction(lead.id, newNote);
    setIsAddingNote(false);
    if (!result.success) {
      toast.error(result.error);
      return;
    }
    setNewNote("");
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <CardTitle className="text-xl">{lead.title}</CardTitle>
              <Badge variant="secondary">{currencyFormatter.format(lead.value)}</Badge>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {lead.company ? (
                <Link href={`/dashboard/companies/${lead.company.id}`} className="hover:underline">
                  {lead.company.name}
                </Link>
              ) : (
                "No company"
              )}
              {lead.contact && (
                <>
                  {" · "}
                  <Link href={`/dashboard/contacts/${lead.contact.id}`} className="hover:underline">
                    {lead.contact.firstName} {lead.contact.lastName}
                  </Link>
                </>
              )}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Select value={lead.stageId} onValueChange={handleStageChange} disabled={isChangingStage}>
              <SelectTrigger aria-label="Lead stage" className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {stages.map((stage) => (
                  <SelectItem key={stage.id} value={stage.id}>
                    {stage.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Dialog>
              <DialogTrigger asChild>
                <Button variant="destructive" size="sm">
                  Delete
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Delete {lead.title}?</DialogTitle>
                  <DialogDescription>This removes the lead from the pipeline and search.</DialogDescription>
                </DialogHeader>
                <DialogFooter>
                  <Button variant="destructive" disabled={isDeleting} onClick={handleDelete}>
                    {isDeleting ? "Deleting…" : "Delete lead"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSave} className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="flex flex-col gap-2 sm:col-span-3">
              <Label htmlFor="edit-title">Title</Label>
              <Input id="edit-title" required value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="edit-value">Value (USD)</Label>
              <Input id="edit-value" type="number" min={0} step="0.01" value={value} onChange={(e) => setValue(e.target.value)} />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="edit-probability">Probability (%)</Label>
              <Input
                id="edit-probability"
                type="number"
                min={0}
                max={100}
                value={probability}
                onChange={(e) => setProbability(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="edit-source">Source</Label>
              <Input id="edit-source" value={source} onChange={(e) => setSource(e.target.value)} />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="edit-owner">Owner</Label>
              <Select value={ownerId} onValueChange={setOwnerId}>
                <SelectTrigger id="edit-owner">
                  <SelectValue placeholder="Unassigned" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Unassigned</SelectItem>
                  {members.map((member) => (
                    <SelectItem key={member.id} value={member.id}>
                      {member.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-3 sm:col-span-3">
              <Button type="submit" disabled={isSaving}>
                {isSaving ? "Saving…" : "Save changes"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {lead.tasks.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Tasks ({lead.tasks.length})</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {lead.tasks.map((task) => (
              <div key={task.id} className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
                <span>{task.title}</span>
                <div className="flex items-center gap-2">
                  {task.dueDate && (
                    <span className="text-xs text-muted-foreground">
                      {new Date(task.dueDate).toLocaleDateString()}
                    </span>
                  )}
                  <Badge variant="secondary" className="capitalize">
                    {task.status.replace("_", " ")}
                  </Badge>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Activity timeline</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <form onSubmit={handleAddNote} className="flex flex-col gap-2">
            <Label htmlFor="new-lead-note">Add a note</Label>
            <Textarea
              id="new-lead-note"
              value={newNote}
              onChange={(e) => setNewNote(e.target.value)}
              placeholder="Spoke with the champion, moving to proposal next week…"
            />
            <Button type="submit" disabled={isAddingNote || newNote.trim().length === 0} className="w-fit">
              {isAddingNote ? "Saving…" : "Add note"}
            </Button>
          </form>
          <Separator />
          <ol className="flex flex-col gap-3">
            {lead.activities.length === 0 && (
              <p className="text-sm text-muted-foreground">No activity yet.</p>
            )}
            {lead.activities.map((activity) => (
              <li key={activity.id} className="rounded-md border p-3 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <Badge variant="outline" className="capitalize">
                    {activity.type.replace("_", " ")}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {new Date(activity.createdAt).toLocaleString()}
                  </span>
                </div>
                {activity.body && <p className="mt-2 whitespace-pre-wrap">{activity.body}</p>}
                {activity.actor && (
                  <p className="mt-1 text-xs text-muted-foreground">by {activity.actor.name}</p>
                )}
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>
    </div>
  );
}
