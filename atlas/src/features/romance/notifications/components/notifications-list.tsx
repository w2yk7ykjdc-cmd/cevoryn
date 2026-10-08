"use client";

import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

import {
  markAllNotificationsReadAction,
  markNotificationReadAction,
} from "../actions/mark-read";

interface NotificationEntry {
  id: string;
  title: string;
  body: string;
  isRead: boolean;
  createdAt: string;
}

export function NotificationsList({
  initialNotifications,
}: {
  initialNotifications: NotificationEntry[];
}) {
  const [notifications, setNotifications] = useState(initialNotifications);
  const [isPending, setIsPending] = useState(false);

  const hasUnread = notifications.some((n) => !n.isRead);

  async function handleMarkRead(id: string) {
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, isRead: true } : n)));
    const result = await markNotificationReadAction(id);
    if (!result.success) {
      toast.error("Could not update that notice.");
    }
  }

  async function handleMarkAllRead() {
    if (isPending) return;
    setIsPending(true);
    try {
      setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
      const result = await markAllNotificationsReadAction();
      if (!result.success) {
        toast.error("Could not update your notices.");
      }
    } finally {
      setIsPending(false);
    }
  }

  if (notifications.length === 0) {
    return <p className="text-sm text-[#a08bb0]">No notices yet. The story will tell you when something real happens.</p>;
  }

  return (
    <div className="space-y-4">
      {hasUnread && (
        <Button
          type="button"
          onClick={handleMarkAllRead}
          disabled={isPending}
          variant="outline"
          className="border-white/20 text-[#c9b8d4] hover:text-white"
        >
          Mark all as read
        </Button>
      )}
      <ul className="space-y-3">
        {notifications.map((notification) => (
          <li
            key={notification.id}
            className={`rounded-lg border p-4 ${
              notification.isRead
                ? "border-white/10 bg-[#140b1b]/40"
                : "border-[#c9a7e0]/40 bg-[#1c1024]/70"
            }`}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-medium text-[#f1e9f4]">{notification.title}</p>
                <p className="mt-1 text-sm text-[#c9b8d4]">{notification.body}</p>
              </div>
              {!notification.isRead && (
                <button
                  type="button"
                  onClick={() => handleMarkRead(notification.id)}
                  className="shrink-0 rounded-md px-2 py-1 text-xs text-[#c9a7e0] underline hover:text-white"
                >
                  Mark read
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
