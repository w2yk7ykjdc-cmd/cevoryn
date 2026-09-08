"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import {
  addNoteAction,
  addTagAction,
  deleteContactAction,
  removeTagAction,
  updateContactAction,
} from "@/app/(dashboard)/dashboard/contacts/actions";
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

const NO_COMPANY = "__none__";

type ContactDetailData = {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  title: string | null;
  companyId: string | null;
  company: { id: string; name: string } | null;
  tags: { tag: { id: string; name: string } }[];
  notes: { id: string; body: string; createdAt: Date; author: { name: string } | null }[];
};

export function ContactDetail({
  contact,
  companies,
}: {
  contact: ContactDetailData;
  companies: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [firstName, setFirstName] = useState(contact.firstName);
  const [lastName, setLastName] = useState(contact.lastName);
  const [email, setEmail] = useState(contact.email ?? "");
  const [phone, setPhone] = useState(contact.phone ?? "");
  const [title, setTitle] = useState(contact.title ?? "");
  const [companyId, setCompanyId] = useState(contact.companyId ?? NO_COMPANY);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [newTag, setNewTag] = useState("");
  const [isAddingTag, setIsAddingTag] = useState(false);
  const [newNote, setNewNote] = useState("");
  const [isAddingNote, setIsAddingNote] = useState(false);

  async function handleSave(event: React.FormEvent) {
    event.preventDefault();
    setIsSaving(true);
    const result = await updateContactAction(contact.id, {
      firstName,
      lastName,
      email: email || null,
      phone: phone || null,
      title: title || null,
      companyId: companyId === NO_COMPANY ? null : companyId,
    });
    setIsSaving(false);
    if (!result.success) {
      toast.error(result.error);
      return;
    }
    toast.success("Contact updated");
    router.refresh();
  }

  async function handleDelete() {
    setIsDeleting(true);
    const result = await deleteContactAction(contact.id);
    setIsDeleting(false);
    if (!result.success) {
      toast.error(result.error);
      return;
    }
    toast.success("Contact deleted");
    router.push("/dashboard/contacts");
    router.refresh();
  }

  async function handleAddTag(event: React.FormEvent) {
    event.preventDefault();
    if (!newTag.trim()) return;
    setIsAddingTag(true);
    const result = await addTagAction(contact.id, newTag);
    setIsAddingTag(false);
    if (!result.success) {
      toast.error(result.error);
      return;
    }
    setNewTag("");
    router.refresh();
  }

  async function handleRemoveTag(tagId: string) {
    const result = await removeTagAction(contact.id, tagId);
    if (!result.success) {
      toast.error(result.error);
      return;
    }
    router.refresh();
  }

  async function handleAddNote(event: React.FormEvent) {
    event.preventDefault();
    if (!newNote.trim()) return;
    setIsAddingNote(true);
    const result = await addNoteAction(contact.id, newNote);
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
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <CardTitle className="text-xl">
            {contact.firstName} {contact.lastName}
          </CardTitle>
          <Dialog>
            <DialogTrigger asChild>
              <Button variant="destructive" size="sm">
                Delete
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>
                  Delete {contact.firstName} {contact.lastName}?
                </DialogTitle>
                <DialogDescription>This removes the contact from lists and search.</DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="destructive" disabled={isDeleting} onClick={handleDelete}>
                  {isDeleting ? "Deleting…" : "Delete contact"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSave} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="edit-first-name">First name</Label>
              <Input id="edit-first-name" required value={firstName} onChange={(e) => setFirstName(e.target.value)} />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="edit-last-name">Last name</Label>
              <Input id="edit-last-name" required value={lastName} onChange={(e) => setLastName(e.target.value)} />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="edit-email">Email</Label>
              <Input id="edit-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="edit-phone">Phone</Label>
              <Input id="edit-phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="edit-title">Title</Label>
              <Input id="edit-title" value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="edit-company">Company</Label>
              <Select value={companyId} onValueChange={setCompanyId}>
                <SelectTrigger id="edit-company">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_COMPANY}>No company</SelectItem>
                  {companies.map((company) => (
                    <SelectItem key={company.id} value={company.id}>
                      {company.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="sm:col-span-2">
              <Button type="submit" disabled={isSaving}>
                {isSaving ? "Saving…" : "Save changes"}
              </Button>
            </div>
          </form>
          {contact.company && (
            <p className="mt-2 text-sm text-muted-foreground">
              At{" "}
              <Link href={`/dashboard/companies/${contact.company.id}`} className="hover:underline">
                {contact.company.name}
              </Link>
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Tags</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-wrap gap-2">
            {contact.tags.length === 0 && <p className="text-sm text-muted-foreground">No tags yet.</p>}
            {contact.tags.map(({ tag }) => (
              <Badge key={tag.id} variant="secondary" className="gap-1">
                {tag.name}
                <button
                  type="button"
                  onClick={() => handleRemoveTag(tag.id)}
                  aria-label={`Remove tag ${tag.name}`}
                  className="ml-1 rounded-full outline-none hover:text-destructive focus-visible:ring-2 focus-visible:ring-ring/50"
                >
                  ×
                </button>
              </Badge>
            ))}
          </div>
          <form onSubmit={handleAddTag} className="flex gap-2">
            <Input
              value={newTag}
              onChange={(e) => setNewTag(e.target.value)}
              placeholder="Add a tag…"
              aria-label="New tag name"
              className="max-w-56"
            />
            <Button type="submit" variant="outline" disabled={isAddingTag || newTag.trim().length === 0}>
              Add tag
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Notes</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <form onSubmit={handleAddNote} className="flex flex-col gap-2">
            <Label htmlFor="new-note">Add a note</Label>
            <Textarea
              id="new-note"
              value={newNote}
              onChange={(e) => setNewNote(e.target.value)}
              placeholder="Called about renewal, follow up next week…"
            />
            <Button type="submit" disabled={isAddingNote || newNote.trim().length === 0} className="w-fit">
              {isAddingNote ? "Saving…" : "Add note"}
            </Button>
          </form>
          <Separator />
          <div className="flex flex-col gap-3">
            {contact.notes.length === 0 && <p className="text-sm text-muted-foreground">No notes yet.</p>}
            {contact.notes.map((note) => (
              <div key={note.id} className="rounded-md border p-3 text-sm">
                <p className="whitespace-pre-wrap">{note.body}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {note.author?.name ?? "Deleted user"} · {new Date(note.createdAt).toLocaleString()}
                </p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
