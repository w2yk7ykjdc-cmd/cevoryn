"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { createApiKeyAction, revokeApiKeyAction } from "@/app/(dashboard)/dashboard/settings/api-keys/actions";

type ApiKeyRow = {
  id: string;
  name: string;
  keyPrefix: string;
  scopes: string[];
  createdAt: Date;
  lastUsedAt: Date | null;
  expiresAt: Date | null;
  revokedAt: Date | null;
  createdByName: string;
};

function statusFor(key: ApiKeyRow): { label: string; variant: "default" | "outline" | "destructive" } {
  if (key.revokedAt) return { label: "Revoked", variant: "destructive" };
  if (key.expiresAt && key.expiresAt.getTime() < Date.now()) return { label: "Expired", variant: "outline" };
  return { label: "Active", variant: "default" };
}

export function ApiKeysClient({ initialKeys }: { initialKeys: ApiKeyRow[] }) {
  const router = useRouter();
  const [keys, setKeys] = useState(initialKeys);
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [newKey, setNewKey] = useState<string | null>(null);

  async function handleCreate(event: React.FormEvent) {
    event.preventDefault();
    setIsCreating(true);
    const result = await createApiKeyAction({ name });
    setIsCreating(false);

    if (!result.success) {
      toast.error(result.error);
      return;
    }
    setName("");
    setCreateOpen(false);
    setNewKey(result.plaintextKey);
    router.refresh();
  }

  async function handleRevoke(id: string) {
    setRevokingId(id);
    const result = await revokeApiKeyAction(id);
    setRevokingId(null);

    if (!result.success) {
      toast.error(result.error);
      return;
    }
    setKeys((prev) => prev.map((k) => (k.id === id ? { ...k, revokedAt: new Date() } : k)));
    toast.success("API key revoked");
  }

  async function copyKey() {
    if (!newKey) return;
    try {
      await navigator.clipboard.writeText(newKey);
      toast.success("Copied to clipboard");
    } catch {
      toast.error("Couldn't copy — select and copy the key manually");
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button>New API key</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>New API key</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleCreate} className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <Label htmlFor="api-key-name">Name</Label>
                <Input
                  id="api-key-name"
                  required
                  placeholder="e.g. Zapier integration"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
              <DialogFooter>
                <Button type="submit" disabled={isCreating || name.trim().length === 0}>
                  {isCreating ? "Creating…" : "Create key"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <Dialog open={newKey !== null} onOpenChange={(open) => !open && setNewKey(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Your new API key</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Copy this now — for your security, it won&apos;t be shown again. If you lose it, revoke this key and
            create a new one.
          </p>
          <div className="flex items-center gap-2 rounded-md border bg-muted p-3">
            <code className="flex-1 overflow-x-auto text-xs">{newKey}</code>
            <Button type="button" size="sm" variant="outline" onClick={copyKey}>
              Copy
            </Button>
          </div>
          <DialogFooter>
            <Button type="button" onClick={() => setNewKey(null)}>
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Key</TableHead>
            <TableHead>Created by</TableHead>
            <TableHead>Last used</TableHead>
            <TableHead>Status</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {keys.length === 0 && (
            <TableRow>
              <TableCell colSpan={6} className="text-center text-sm text-muted-foreground">
                No API keys yet.
              </TableCell>
            </TableRow>
          )}
          {keys.map((key) => {
            const status = statusFor(key);
            return (
              <TableRow key={key.id}>
                <TableCell className="font-medium">{key.name}</TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">{key.keyPrefix}••••••••</TableCell>
                <TableCell className="text-sm text-muted-foreground">{key.createdByName}</TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {key.lastUsedAt ? new Date(key.lastUsedAt).toLocaleDateString() : "Never"}
                </TableCell>
                <TableCell>
                  <Badge variant={status.variant}>{status.label}</Badge>
                </TableCell>
                <TableCell className="text-right">
                  {!key.revokedAt && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={revokingId === key.id}
                      onClick={() => handleRevoke(key.id)}
                    >
                      Revoke
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
