"use client";

import { Bell } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { handleUnauthorized } from "@/lib/client-auth";

const POLL_INTERVAL_MS = 60_000;

/**
 * Where a notification's entityType should take the user - both currently-
 * produced entity-linked types (see radar-pipeline.service.ts and
 * research-worker.ts) surface on the Radar feed, since there is no
 * dedicated per-opportunity or per-research-task page. Anything not
 * listed here (org-wide alerts with no entity) is not clickable-through.
 */
const ENTITY_TYPE_DESTINATION: Record<string, string> = {
  opportunity: "/radar",
  research_task: "/radar",
};

interface NotificationRow {
  id: string;
  type: string;
  title: string;
  body: string;
  readAt: string | null;
  createdAt: string;
  entityType: string | null;
  entityId: string | null;
}

export function NotificationBell() {
  const router = useRouter();
  const [notifications, setNotifications] = useState<NotificationRow[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [open, setOpen] = useState(false);

  async function load() {
    try {
      const response = await fetch("/api/radar/notifications");
      if (handleUnauthorized(response)) return;
      if (!response.ok) return;

      const data = (await response.json()) as {
        data: { notifications: NotificationRow[]; unreadCount: number };
      };
      setNotifications(data.data.notifications);
      setUnreadCount(data.data.unreadCount);
    } catch (_error) {
      // Best-effort - a failed poll just leaves the last-known state.
    }
  }

  useEffect(() => {
    load();
    const interval = setInterval(load, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);

  async function markRead(id: string) {
    setNotifications((prev) =>
      prev.map((n) =>
        n.id === id ? { ...n, readAt: new Date().toISOString() } : n
      )
    );
    setUnreadCount((prev) => Math.max(0, prev - 1));
    try {
      await fetch(`/api/radar/notifications/${id}/read`, { method: "POST" });
    } catch (_error) {
      // Non-critical - next poll reconciles state.
    }
  }

  async function markAllRead() {
    setNotifications((prev) =>
      prev.map((n) => ({ ...n, readAt: n.readAt ?? new Date().toISOString() }))
    );
    setUnreadCount(0);
    try {
      await fetch("/api/radar/notifications/read-all", { method: "POST" });
    } catch (_error) {
      // Non-critical - next poll reconciles state.
    }
  }

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative"
          aria-label="Notifications"
        >
          <Bell className="h-5 w-5" />
          {unreadCount > 0 ? (
            <Badge
              variant="destructive"
              className="absolute -right-1 -top-1 h-4 min-w-4 px-1 text-[10px] leading-4"
            >
              {unreadCount > 9 ? "9+" : unreadCount}
            </Badge>
          ) : null}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <div className="flex items-center justify-between px-2 py-1.5">
          <DropdownMenuLabel className="p-0">Notifications</DropdownMenuLabel>
          {unreadCount > 0 ? (
            <button
              type="button"
              className="text-xs text-muted-foreground hover:text-foreground"
              onClick={markAllRead}
            >
              Mark all read
            </button>
          ) : null}
        </div>
        <DropdownMenuSeparator />
        {notifications.length === 0 ? (
          <div className="px-2 py-4 text-center text-sm text-muted-foreground">
            No notifications yet
          </div>
        ) : (
          notifications.slice(0, 10).map((notification) => {
            const destination = notification.entityType
              ? ENTITY_TYPE_DESTINATION[notification.entityType]
              : undefined;
            return (
            <DropdownMenuItem
              key={notification.id}
              className="flex flex-col items-start gap-0.5 whitespace-normal"
              onSelect={() => {
                if (!notification.readAt) markRead(notification.id);
                if (destination) router.push(destination);
              }}
            >
              <span className="flex w-full items-center gap-2 text-sm font-medium">
                {!notification.readAt ? (
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                ) : null}
                {notification.title}
              </span>
              <span className="text-xs text-muted-foreground">
                {notification.body}
              </span>
            </DropdownMenuItem>
            );
          })
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
