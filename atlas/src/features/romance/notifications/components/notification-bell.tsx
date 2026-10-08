import Link from "next/link";

/** Server Component - unreadCount is fetched once per page load by the layout; no client polling (no push/real-time infra exists for this yet, see Product Bible's post-MVP boundary). */
export function NotificationBell({ unreadCount }: { unreadCount: number }) {
  return (
    <Link
      href="/romance/notifications"
      className="relative hidden rounded-md px-2 py-1 underline hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#c9a7e0] sm:inline"
      aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : "Notifications"}
    >
      Notices
      {unreadCount > 0 && (
        <span className="ml-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-[#c9a7e0] px-1 text-[10px] font-semibold text-[#160c1e]">
          {unreadCount > 9 ? "9+" : unreadCount}
        </span>
      )}
    </Link>
  );
}
