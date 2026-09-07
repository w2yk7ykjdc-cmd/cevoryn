"use client";

import {
  ChevronDown,
  ChevronUp,
  Loader2,
  Pause,
  Play,
  Plus,
  X,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { handleUnauthorized } from "@/lib/client-auth";
import { cn } from "@/lib/utils";

interface WatchedEntityRow {
  id: string;
  name: string;
  domain: string | null;
  watchReason: string;
  isPaused: boolean;
  priority: number;
  tags: string[];
  notes: string;
}

type WatchReason =
  "PROSPECT" | "CUSTOMER" | "COMPETITOR" | "SUPPLIER" | "OTHER";

interface WatchlistManagerProps {
  canManage: boolean;
  initialEntities: WatchedEntityRow[];
}

function toCsv(values: string[]): string {
  return values.join(", ");
}

function fromCsv(value: string): string[] {
  return value
    .split(",")
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
}

export function WatchlistManager({
  canManage,
  initialEntities,
}: WatchlistManagerProps) {
  const t = useTranslations("radar.watchlist_page");
  const [entities, setEntities] = useState(initialEntities);
  const [name, setName] = useState("");
  const [domain, setDomain] = useState("");
  const [watchReason, setWatchReason] = useState<WatchReason>("PROSPECT");
  const [priority, setPriority] = useState(5);
  const [tags, setTags] = useState("");
  const [notes, setNotes] = useState("");
  const [showAddAdvanced, setShowAddAdvanced] = useState(false);
  const [isAdding, setIsAdding] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [pausingId, setPausingId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<{
    priority: number;
    tags: string;
    notes: string;
  } | null>(null);

  async function addEntity() {
    if (!name.trim()) return;
    setIsAdding(true);
    try {
      const response = await fetch("/api/radar/entities", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          domain: domain.trim() || null,
          watchReason,
          priority,
          tags: fromCsv(tags),
          notes: notes.trim(),
          metadata: {},
        }),
      });
      if (handleUnauthorized(response)) return;

      const data = await response.json().catch(() => null);
      if (response.status === 409) {
        toast.error(t("duplicate"));
        return;
      }
      if (!response.ok) {
        toast.error(data?.error?.message ?? t("addFailed"));
        return;
      }

      setEntities((prev) => [
        {
          id: data.data.id,
          name: data.data.name,
          domain: data.data.domain,
          watchReason: data.data.watchReason,
          isPaused: data.data.isPaused,
          priority: data.data.priority,
          tags: data.data.tags,
          notes: data.data.notes,
        },
        ...prev,
      ]);
      setName("");
      setDomain("");
      setPriority(5);
      setTags("");
      setNotes("");
      toast.success(t("added"));
    } catch (_error) {
      toast.error(t("addFailed"));
    } finally {
      setIsAdding(false);
    }
  }

  async function removeEntity(id: string) {
    setRemovingId(id);
    try {
      const response = await fetch(`/api/radar/entities/${id}`, {
        method: "DELETE",
      });
      if (handleUnauthorized(response)) return;
      if (!response.ok) throw new Error(t("removeFailed"));

      setEntities((prev) => prev.filter((entity) => entity.id !== id));
      toast.success(t("removed"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("removeFailed"));
    } finally {
      setRemovingId(null);
    }
  }

  async function togglePause(entity: WatchedEntityRow) {
    setPausingId(entity.id);
    try {
      const response = await fetch(`/api/radar/entities/${entity.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isPaused: !entity.isPaused }),
      });
      if (handleUnauthorized(response)) return;
      if (!response.ok) throw new Error(t("updateFailed"));

      setEntities((prev) =>
        prev.map((e) =>
          e.id === entity.id ? { ...e, isPaused: !entity.isPaused } : e
        )
      );
      toast.success(entity.isPaused ? t("resumed") : t("paused"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("updateFailed"));
    } finally {
      setPausingId(null);
    }
  }

  function startEdit(entity: WatchedEntityRow) {
    setEditingId(entity.id);
    setEditDraft({
      priority: entity.priority,
      tags: toCsv(entity.tags),
      notes: entity.notes,
    });
  }

  async function saveEdit(id: string) {
    if (!editDraft) return;
    setSavingId(id);
    try {
      const response = await fetch(`/api/radar/entities/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          priority: editDraft.priority,
          tags: fromCsv(editDraft.tags),
          notes: editDraft.notes.trim(),
        }),
      });
      if (handleUnauthorized(response)) return;
      if (!response.ok) throw new Error(t("updateFailed"));

      setEntities((prev) =>
        prev.map((e) =>
          e.id === id
            ? {
                ...e,
                priority: editDraft.priority,
                tags: fromCsv(editDraft.tags),
                notes: editDraft.notes.trim(),
              }
            : e
        )
      );
      setEditingId(null);
      setEditDraft(null);
      toast.success(t("updated"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("updateFailed"));
    } finally {
      setSavingId(null);
    }
  }

  return (
    <div className="space-y-4">
      {canManage ? (
        <Card>
          <CardContent className="space-y-3 pt-6">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="watchlist-name">{t("name")}</Label>
                <Input
                  id="watchlist-name"
                  value={name}
                  disabled={isAdding}
                  onChange={(event) => setName(event.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="watchlist-domain">{t("domain")}</Label>
                <Input
                  id="watchlist-domain"
                  value={domain}
                  disabled={isAdding}
                  placeholder="example.com"
                  onChange={(event) => setDomain(event.target.value)}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="watchlist-reason">{t("watchReason")}</Label>
              <select
                id="watchlist-reason"
                value={watchReason}
                disabled={isAdding}
                onChange={(event) =>
                  setWatchReason(event.target.value as WatchReason)
                }
                className={cn(
                  "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                )}
              >
                <option value="PROSPECT">{t("reasonProspect")}</option>
                <option value="CUSTOMER">{t("reasonCustomer")}</option>
                <option value="COMPETITOR">{t("reasonCompetitor")}</option>
                <option value="SUPPLIER">{t("reasonSupplier")}</option>
                <option value="OTHER">{t("reasonOther")}</option>
              </select>
            </div>

            <button
              type="button"
              aria-expanded={showAddAdvanced}
              aria-controls="watchlist-advanced-fields"
              onClick={() => setShowAddAdvanced((prev) => !prev)}
              className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
            >
              {showAddAdvanced ? (
                <ChevronUp className="h-3.5 w-3.5" />
              ) : (
                <ChevronDown className="h-3.5 w-3.5" />
              )}
              {showAddAdvanced ? t("hideAdvanced") : t("showAdvanced")}
            </button>

            {showAddAdvanced ? (
              <div
                id="watchlist-advanced-fields"
                className="grid grid-cols-1 gap-3 sm:grid-cols-2"
              >
                <div className="space-y-1.5">
                  <Label htmlFor="watchlist-priority">{t("priority")}</Label>
                  <Input
                    id="watchlist-priority"
                    type="number"
                    min={1}
                    max={10}
                    value={priority}
                    disabled={isAdding}
                    onChange={(event) =>
                      setPriority(
                        Math.min(
                          10,
                          Math.max(1, Number(event.target.value) || 5)
                        )
                      )
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="watchlist-tags">{t("tags")}</Label>
                  <Input
                    id="watchlist-tags"
                    value={tags}
                    disabled={isAdding}
                    placeholder={t("listFieldHint")}
                    onChange={(event) => setTags(event.target.value)}
                  />
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor="watchlist-notes">{t("notes")}</Label>
                  <Textarea
                    id="watchlist-notes"
                    value={notes}
                    disabled={isAdding}
                    rows={2}
                    onChange={(event) => setNotes(event.target.value)}
                  />
                </div>
              </div>
            ) : null}

            <Button
              type="button"
              onClick={addEntity}
              disabled={isAdding || !name.trim()}
            >
              {isAdding ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Plus className="h-4 w-4" />
              )}
              {t("add")}
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {entities.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            {t("empty")}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="divide-y p-0">
            {entities.map((entity) => (
              <div key={entity.id} className="p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-sm font-medium">
                        {entity.name}
                      </p>
                      {entity.isPaused ? (
                        <Badge variant="secondary">{t("pausedBadge")}</Badge>
                      ) : null}
                      <Badge variant="outline">P{entity.priority}</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {entity.watchReason}
                      {entity.domain ? ` · ${entity.domain}` : ""}
                    </p>
                    {entity.tags.length > 0 ? (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {entity.tags.map((tag) => (
                          <Badge
                            key={tag}
                            variant="secondary"
                            className="font-normal"
                          >
                            {tag}
                          </Badge>
                        ))}
                      </div>
                    ) : null}
                  </div>
                  {canManage ? (
                    <div className="flex shrink-0 items-center gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={pausingId === entity.id}
                        onClick={() => togglePause(entity)}
                        aria-label={entity.isPaused ? t("resume") : t("pause")}
                      >
                        {pausingId === entity.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : entity.isPaused ? (
                          <Play className="h-4 w-4" />
                        ) : (
                          <Pause className="h-4 w-4" />
                        )}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          editingId === entity.id
                            ? setEditingId(null)
                            : startEdit(entity)
                        }
                      >
                        {t("edit")}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={removingId === entity.id}
                        onClick={() => removeEntity(entity.id)}
                        aria-label={t("remove")}
                      >
                        {removingId === entity.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <X className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                  ) : null}
                </div>

                {editingId === entity.id && editDraft ? (
                  <div className="mt-3 space-y-3 rounded-md border bg-muted/30 p-3">
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div className="space-y-1.5">
                        <Label htmlFor={`edit-priority-${entity.id}`}>
                          {t("priority")}
                        </Label>
                        <Input
                          id={`edit-priority-${entity.id}`}
                          type="number"
                          min={1}
                          max={10}
                          value={editDraft.priority}
                          onChange={(event) =>
                            setEditDraft((prev) =>
                              prev
                                ? {
                                    ...prev,
                                    priority: Math.min(
                                      10,
                                      Math.max(
                                        1,
                                        Number(event.target.value) || 5
                                      )
                                    ),
                                  }
                                : prev
                            )
                          }
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor={`edit-tags-${entity.id}`}>
                          {t("tags")}
                        </Label>
                        <Input
                          id={`edit-tags-${entity.id}`}
                          value={editDraft.tags}
                          placeholder={t("listFieldHint")}
                          onChange={(event) =>
                            setEditDraft((prev) =>
                              prev
                                ? { ...prev, tags: event.target.value }
                                : prev
                            )
                          }
                        />
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor={`edit-notes-${entity.id}`}>
                        {t("notes")}
                      </Label>
                      <Textarea
                        id={`edit-notes-${entity.id}`}
                        value={editDraft.notes}
                        rows={2}
                        onChange={(event) =>
                          setEditDraft((prev) =>
                            prev ? { ...prev, notes: event.target.value } : prev
                          )
                        }
                      />
                    </div>
                    <Button
                      size="sm"
                      onClick={() => saveEdit(entity.id)}
                      disabled={savingId === entity.id}
                    >
                      {savingId === entity.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : null}
                      {t("save")}
                    </Button>
                  </div>
                ) : null}
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
