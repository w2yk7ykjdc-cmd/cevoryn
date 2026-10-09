"use client";

import Link from "next/link";
import { Bell, BookOpen, Heart, Mail, Sparkles } from "lucide-react";
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
    if (!result.success) toast.error("Could not update that notice.");
  }

  async function handleMarkAllRead() {
    if (isPending) return;
    setIsPending(true);
    try {
      setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
      const result = await markAllNotificationsReadAction();
      if (!result.success) toast.error("Could not update your notices.");
    } finally {
      setIsPending(false);
    }
  }

  return (
    <section className="space-y-6 sm:space-y-8">
      <div className="space-y-2">
        <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-[#bd4968]">Your world, unfolding</p>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="font-serif text-4xl tracking-[-0.045em] text-[#342421] sm:text-5xl">Notices</h1>
            <p className="mt-3 max-w-xl text-sm leading-6 text-[#796b67] sm:text-base">
              A quiet place for the moments that bring your story closer.
            </p>
          </div>
          {hasUnread && (
            <Button
              type="button"
              onClick={handleMarkAllRead}
              disabled={isPending}
              variant="outline"
              className="rounded-full border-[#e4d3cd] bg-white/80 text-[#6e514e] hover:bg-[#faedf0] hover:text-[#9f2e4c]"
            >
              Mark all as read
            </Button>
          )}
        </div>
        <div className="flex items-center gap-3 pt-1" aria-hidden="true">
          <span className="h-px w-12 bg-[#d7a2aa]" />
          <span className="text-sm text-[#bd4968]">✦</span>
          <span className="h-px w-12 bg-[#eadbd5]" />
        </div>
      </div>

      {notifications.length === 0 ? (
        <div className="relative isolate overflow-hidden rounded-[1.75rem] border border-[#eadbd5] bg-white/75 px-5 py-10 text-center shadow-[0_18px_60px_rgba(89,53,46,0.06)] sm:px-12 sm:py-14">
          <div aria-hidden="true" className="absolute -right-12 -top-16 -z-10 h-56 w-56 rounded-full bg-[#f8e2e5]/70 blur-3xl" />
          <div aria-hidden="true" className="absolute -bottom-16 -left-10 -z-10 h-48 w-48 rounded-full bg-[#f5e9d8]/70 blur-3xl" />
          <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full border border-[#f0d5d8] bg-[#fff4f4] text-[#bd4968] shadow-sm">
            <Mail className="h-8 w-8" strokeWidth={1.5} aria-hidden="true" />
          </div>
          <p className="mt-7 text-[11px] font-semibold uppercase tracking-[0.25em] text-[#bd4968]">A little pause</p>
          <h2 className="mx-auto mt-3 max-w-lg font-serif text-3xl leading-tight tracking-[-0.035em] text-[#342421] sm:text-4xl">
            Nothing here just yet.
          </h2>
          <p className="mx-auto mt-4 max-w-md text-sm leading-6 text-[#796b67] sm:text-base sm:leading-7">
            When a character reaches out, a new chapter arrives, or something special unfolds, you’ll find it here.
          </p>
          <div className="mx-auto mt-8 grid max-w-2xl grid-cols-1 gap-3 text-left sm:grid-cols-3">
            <div className="rounded-2xl border border-[#f0e3de] bg-[#fffaf7] p-4">
              <Mail className="h-5 w-5 text-[#bd4968]" aria-hidden="true" />
              <p className="mt-3 font-serif text-lg text-[#342421]">Character notes</p>
              <p className="mt-1 text-xs leading-5 text-[#887671]">When someone in your story has something to say.</p>
            </div>
            <div className="rounded-2xl border border-[#f0e3de] bg-[#fffaf7] p-4">
              <Sparkles className="h-5 w-5 text-[#bd4968]" aria-hidden="true" />
              <p className="mt-3 font-serif text-lg text-[#342421]">New chapters</p>
              <p className="mt-1 text-xs leading-5 text-[#887671]">A new turn in the worlds you follow.</p>
            </div>
            <div className="rounded-2xl border border-[#f0e3de] bg-[#fffaf7] p-4">
              <Heart className="h-5 w-5 text-[#bd4968]" aria-hidden="true" />
              <p className="mt-3 font-serif text-lg text-[#342421]">Special moments</p>
              <p className="mt-1 text-xs leading-5 text-[#887671]">Discoveries and milestones worth keeping.</p>
            </div>
          </div>
          <Link
            href="/romance"
            className="mt-8 inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-[#b93659] px-7 py-3 text-sm font-semibold text-white shadow-[0_8px_24px_rgba(185,54,89,0.2)] transition hover:bg-[#9f2e4c] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#bd4968]"
          >
            <BookOpen className="h-4 w-4" aria-hidden="true" />
            Return to your story
          </Link>
        </div>
      ) : (
        <ul className="space-y-3">
          {notifications.map((notification) => (
            <li
              key={notification.id}
              className={`rounded-2xl border p-5 shadow-sm transition ${notification.isRead ? "border-[#eadbd5] bg-white/70" : "border-[#e6b5bf] bg-[#fff5f6]"}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-serif text-lg text-[#342421]">{notification.title}</p>
                  <p className="mt-1 text-sm leading-6 text-[#796b67]">{notification.body}</p>
                  <time className="mt-3 block text-xs text-[#a08c85]" dateTime={notification.createdAt}>
                    {new Date(notification.createdAt).toLocaleString()}
                  </time>
                </div>
                {!notification.isRead && (
                  <button
                    type="button"
                    onClick={() => handleMarkRead(notification.id)}
                    className="shrink-0 rounded-full border border-[#e4c9ce] px-3 py-1.5 text-xs font-medium text-[#a52f50] transition hover:bg-white"
                  >
                    Mark read
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
