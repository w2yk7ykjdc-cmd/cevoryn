"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { createCompanyAction } from "@/app/(dashboard)/dashboard/companies/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

export function CreateCompanyDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [name, setName] = useState("");
  const [domain, setDomain] = useState("");
  const [industry, setIndustry] = useState("");
  const [website, setWebsite] = useState("");
  const [description, setDescription] = useState("");

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setIsSubmitting(true);
    const result = await createCompanyAction({ name, domain, industry, website, description });
    setIsSubmitting(false);

    if (!result.success) {
      toast.error(result.error);
      return;
    }
    toast.success("Company created");
    setOpen(false);
    setName("");
    setDomain("");
    setIndustry("");
    setWebsite("");
    setDescription("");
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>New company</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New company</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="company-name">Name</Label>
            <Input id="company-name" required value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="company-domain">Domain</Label>
            <Input
              id="company-domain"
              placeholder="acme.com"
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="company-industry">Industry</Label>
            <Input id="company-industry" value={industry} onChange={(e) => setIndustry(e.target.value)} />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="company-website">Website</Label>
            <Input
              id="company-website"
              type="url"
              placeholder="https://"
              value={website}
              onChange={(e) => setWebsite(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="company-description">Description</Label>
            <Textarea
              id="company-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={isSubmitting || name.trim().length === 0}>
              {isSubmitting ? "Creating…" : "Create company"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
