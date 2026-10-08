import type { Metadata } from "next";

import { NotificationsList } from "@/features/romance/notifications/components/notifications-list";
import { listRomanceNotifications } from "@/features/romance/notifications/romance-notification.service";
import { requireRomancePlayer } from "@/features/romance/player/romance-player-guards";

export const metadata: Metadata = { title: "Notices" };

export default async function RomanceNotificationsPage() {
  const { player } = await requireRomancePlayer();
  const notifications = await listRomanceNotifications(player.id, { take: 50 });

  return (
    <div className="space-y-6">
      <h1 className="font-serif text-xl text-[#f1e9f4]">Notices</h1>
      <NotificationsList
        initialNotifications={notifications.map((n) => ({
          id: n.id,
          title: n.title,
          body: n.body,
          isRead: n.isRead,
          createdAt: n.createdAt.toISOString(),
        }))}
      />
    </div>
  );
}
