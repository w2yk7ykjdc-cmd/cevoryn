"use client";

import { Loader2, Plus, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { handleUnauthorized } from "@/lib/client-auth";
import { cn } from "@/lib/utils";

interface WatchedEntityRow {
  id: string;
  name: string;
  domain: string | null;
  watchReason: string;
}

type WatchReason =
  "PROSPECT" | "CUSTOMER" | "COMPETITOR" | "SUPPLIER" | "OTHER";

interface WatchlistManagerProps {
  canManage: boolean;
  initialEntities: WatchedEntityRow[];
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
  const [isAdding, setIsAdding] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);

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
        },
        ...prev,
      ]);
      setName("");
      setDomain("");
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
              <div
                key={entity.id}
                className="flex items-center justify-between gap-2 p-3"
              >
                <div>
                  <p className="text-sm font-medium">{entity.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {entity.watchReason}
                    {entity.domain ? ` · ${entity.domain}` : ""}
                  </p>
                </div>
                {canManage ? (
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
                ) : null}
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
