import { Bell } from "lucide-react";
import Link from "next/link";

/** Server Component - unreadCount is fetched once per page load by the layout; no client polling (no push/real-time infra exists for this yet, see Product Bible's post-MVP boundary). Icon-only to stay compact in the header at every screen size. */
export function NotificationBell({ unreadCount }: { unreadCount: number }) {
  return (
    <Link
      href="/romance/notifications"
      className="relative inline-flex shrink-0 items-center justify-center rounded-full p-1.5 text-[#c9b8d4] transition hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#c9a7e0]"
      aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : "Notifications"}
    >
      <Bell className="h-4 w-4" aria-hidden="true" />
      {unreadCount > 0 && (
        <span className="absolute -right-0.5 -top-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-[#c9a7e0] px-1 text-[10px] font-semibold text-[#160c1e]">
          {unreadCount > 9 ? "9+" : unreadCount}
        </span>
      )}
    </Link>
  );
}
