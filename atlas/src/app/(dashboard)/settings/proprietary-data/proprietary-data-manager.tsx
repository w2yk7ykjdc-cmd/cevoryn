"use client";

import { Loader2, Plus, X } from "lucide-react";
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

type SourceKind =
  | "DOCUMENT_STORE"
  | "CRM"
  | "ERP"
  | "INTERNAL_API"
  | "KNOWLEDGE_BASE";

const SOURCE_KINDS: SourceKind[] = [
  "KNOWLEDGE_BASE",
  "DOCUMENT_STORE",
  "CRM",
  "ERP",
  "INTERNAL_API",
];

interface ProprietaryDataRecordRow {
  id: string;
  sourceKind: SourceKind;
  title: string;
  content: string;
  url: string | null;
  tags: string[];
  updatedAt: string;
}

interface ProprietaryDataManagerProps {
  canManage: boolean;
  initialRecords: ProprietaryDataRecordRow[];
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

export function ProprietaryDataManager({
  canManage,
  initialRecords,
}: ProprietaryDataManagerProps) {
  const t = useTranslations("settings.proprietaryData");
  const [records, setRecords] = useState(initialRecords);
  const [sourceKind, setSourceKind] = useState<SourceKind>("KNOWLEDGE_BASE");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [url, setUrl] = useState("");
  const [tags, setTags] = useState("");
  const [isAdding, setIsAdding] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<{
    sourceKind: SourceKind;
    title: string;
    content: string;
    url: string;
    tags: string;
  } | null>(null);

  async function addRecord() {
    if (!title.trim() || !content.trim()) return;
    setIsAdding(true);
    try {
      const response = await fetch("/api/enterprise/proprietary-data", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceKind,
          title: title.trim(),
          content: content.trim(),
          url: url.trim() || null,
          tags: fromCsv(tags),
        }),
      });
      if (handleUnauthorized(response)) return;

      const data = await response.json().catch(() => null);
      if (!response.ok) {
        toast.error(data?.error?.message ?? t("addFailed"));
        return;
      }

      setRecords((prev) => [
        {
          id: data.data.id,
          sourceKind: data.data.sourceKind,
          title: data.data.title,
          content: data.data.content,
          url: data.data.url,
          tags: data.data.tags,
          updatedAt: data.data.updatedAt,
        },
        ...prev,
      ]);
      setTitle("");
      setContent("");
      setUrl("");
      setTags("");
      setSourceKind("KNOWLEDGE_BASE");
      toast.success(t("added"));
    } catch (_error) {
      toast.error(t("addFailed"));
    } finally {
      setIsAdding(false);
    }
  }

  async function removeRecord(id: string) {
    setRemovingId(id);
    try {
      const response = await fetch(`/api/enterprise/proprietary-data/${id}`, {
        method: "DELETE",
      });
      if (handleUnauthorized(response)) return;
      if (!response.ok) throw new Error(t("removeFailed"));

      setRecords((prev) => prev.filter((record) => record.id !== id));
      toast.success(t("removed"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("removeFailed"));
    } finally {
      setRemovingId(null);
    }
  }

  function startEdit(record: ProprietaryDataRecordRow) {
    setEditingId(record.id);
    setEditDraft({
      sourceKind: record.sourceKind,
      title: record.title,
      content: record.content,
      url: record.url ?? "",
      tags: toCsv(record.tags),
    });
  }

  async function saveEdit(id: string) {
    if (!editDraft || !editDraft.title.trim() || !editDraft.content.trim()) {
      return;
    }
    setSavingId(id);
    try {
      const response = await fetch(`/api/enterprise/proprietary-data/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceKind: editDraft.sourceKind,
          title: editDraft.title.trim(),
          content: editDraft.content.trim(),
          url: editDraft.url.trim() || null,
          tags: fromCsv(editDraft.tags),
        }),
      });
      if (handleUnauthorized(response)) return;
      if (!response.ok) throw new Error(t("updateFailed"));

      setRecords((prev) =>
        prev.map((record) =>
          record.id === id
            ? {
                ...record,
                sourceKind: editDraft.sourceKind,
                title: editDraft.title.trim(),
                content: editDraft.content.trim(),
                url: editDraft.url.trim() || null,
                tags: fromCsv(editDraft.tags),
              }
            : record
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
                <Label htmlFor="proprietary-title">{t("titleField")}</Label>
                <Input
                  id="proprietary-title"
                  value={title}
                  disabled={isAdding}
                  onChange={(event) => setTitle(event.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="proprietary-source-kind">
                  {t("sourceKind")}
                </Label>
                <select
                  id="proprietary-source-kind"
                  value={sourceKind}
                  disabled={isAdding}
                  onChange={(event) =>
                    setSourceKind(event.target.value as SourceKind)
                  }
                  className={cn(
                    "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  )}
                >
                  {SOURCE_KINDS.map((kind) => (
                    <option key={kind} value={kind}>
                      {t(`sourceKinds.${kind}`)}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="proprietary-content">{t("content")}</Label>
              <Textarea
                id="proprietary-content"
                value={content}
                disabled={isAdding}
                rows={4}
                onChange={(event) => setContent(event.target.value)}
              />
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="proprietary-url">{t("url")}</Label>
                <Input
                  id="proprietary-url"
                  value={url}
                  disabled={isAdding}
                  placeholder="https://example.com/doc"
                  onChange={(event) => setUrl(event.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="proprietary-tags">{t("tags")}</Label>
                <Input
                  id="proprietary-tags"
                  value={tags}
                  disabled={isAdding}
                  placeholder={t("listFieldHint")}
                  onChange={(event) => setTags(event.target.value)}
                />
              </div>
            </div>

            <Button
              type="button"
              onClick={addRecord}
              disabled={isAdding || !title.trim() || !content.trim()}
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

      {records.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            {t("empty")}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="divide-y p-0">
            {records.map((record) => (
              <div key={record.id} className="p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-sm font-medium">
                        {record.title}
                      </p>
                      <Badge variant="outline">
                        {t(`sourceKinds.${record.sourceKind}`)}
                      </Badge>
                    </div>
                    <p className="line-clamp-2 text-xs text-muted-foreground">
                      {record.content}
                    </p>
                    {record.tags.length > 0 ? (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {record.tags.map((tag) => (
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
                        onClick={() =>
                          editingId === record.id
                            ? setEditingId(null)
                            : startEdit(record)
                        }
                      >
                        {t("edit")}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={removingId === record.id}
                        onClick={() => removeRecord(record.id)}
                        aria-label={t("remove")}
                      >
                        {removingId === record.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <X className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                  ) : null}
                </div>

                {editingId === record.id && editDraft ? (
                  <div className="mt-3 space-y-3 rounded-md border bg-muted/30 p-3">
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div className="space-y-1.5">
                        <Label htmlFor={`edit-title-${record.id}`}>
                          {t("titleField")}
                        </Label>
                        <Input
                          id={`edit-title-${record.id}`}
                          value={editDraft.title}
                          onChange={(event) =>
                            setEditDraft((prev) =>
                              prev
                                ? { ...prev, title: event.target.value }
                                : prev
                            )
                          }
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor={`edit-source-kind-${record.id}`}>
                          {t("sourceKind")}
                        </Label>
                        <select
                          id={`edit-source-kind-${record.id}`}
                          value={editDraft.sourceKind}
                          onChange={(event) =>
                            setEditDraft((prev) =>
                              prev
                                ? {
                                    ...prev,
                                    sourceKind: event.target
                                      .value as SourceKind,
                                  }
                                : prev
                            )
                          }
                          className={cn(
                            "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                          )}
                        >
                          {SOURCE_KINDS.map((kind) => (
                            <option key={kind} value={kind}>
                              {t(`sourceKinds.${kind}`)}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor={`edit-content-${record.id}`}>
                        {t("content")}
                      </Label>
                      <Textarea
                        id={`edit-content-${record.id}`}
                        value={editDraft.content}
                        rows={4}
                        onChange={(event) =>
                          setEditDraft((prev) =>
                            prev
                              ? { ...prev, content: event.target.value }
                              : prev
                          )
                        }
                      />
                    </div>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div className="space-y-1.5">
                        <Label htmlFor={`edit-url-${record.id}`}>
                          {t("url")}
                        </Label>
                        <Input
                          id={`edit-url-${record.id}`}
                          value={editDraft.url}
                          onChange={(event) =>
                            setEditDraft((prev) =>
                              prev ? { ...prev, url: event.target.value } : prev
                            )
                          }
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor={`edit-tags-${record.id}`}>
                          {t("tags")}
                        </Label>
                        <Input
                          id={`edit-tags-${record.id}`}
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
                    <Button
                      size="sm"
                      onClick={() => saveEdit(record.id)}
                      disabled={
                        savingId === record.id ||
                        !editDraft.title.trim() ||
                        !editDraft.content.trim()
                      }
                    >
                      {savingId === record.id ? (
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
