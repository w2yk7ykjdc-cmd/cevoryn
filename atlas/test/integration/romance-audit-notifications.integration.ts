/**
 * Real Postgres integration coverage for the Romance audit trail
 * (src/features/romance/audit/romance-audit.service.ts) and in-app
 * notifications (src/features/romance/notifications/romance-notification.service.ts) -
 * the two tables (RomanceAuditLog, RomanceNotification) that existed in
 * the schema with zero write path before this suite's accompanying code.
 *
 * NEVER RUN THIS AGAINST PRODUCTION. Requires INTEGRATION_DATABASE_URL,
 * refuses a Supabase-shaped host, run via `npm run test:integration`.
 */
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";

import type {
  listRomanceAuditLogs as ListRomanceAuditLogsType,
  recordRomanceAuditEvent as RecordRomanceAuditEventType,
} from "../../src/features/romance/audit/romance-audit.service";
import type {
  countUnreadRomanceNotifications as CountUnreadRomanceNotificationsType,
  createRomanceNotification as CreateRomanceNotificationType,
  listRomanceNotifications as ListRomanceNotificationsType,
  markAllRomanceNotificationsRead as MarkAllRomanceNotificationsReadType,
  markRomanceNotificationRead as MarkRomanceNotificationReadType,
} from "../../src/features/romance/notifications/romance-notification.service";
import type { prisma as PrismaType } from "../../src/lib/prisma";

const INTEGRATION_DATABASE_URL = process.env.INTEGRATION_DATABASE_URL;

if (!INTEGRATION_DATABASE_URL) {
  console.error(
    "\nINTEGRATION_DATABASE_URL is not set.\n" +
      "This suite requires a real, disposable local Postgres database - it must\n" +
      "never point at production. Example:\n\n" +
      "  INTEGRATION_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/cevoryn_integration_test \\\n" +
      "    npm run test:integration\n"
  );
  process.exit(1);
}

if (/supabase\.co/i.test(INTEGRATION_DATABASE_URL)) {
  console.error(
    "INTEGRATION_DATABASE_URL looks like a Supabase (production-shaped) host - refusing to run."
  );
  process.exit(1);
}

const RUN_ID = randomUUID().slice(0, 8);

let prisma: typeof PrismaType;
let recordRomanceAuditEvent: typeof RecordRomanceAuditEventType;
let listRomanceAuditLogs: typeof ListRomanceAuditLogsType;
let createRomanceNotification: typeof CreateRomanceNotificationType;
let listRomanceNotifications: typeof ListRomanceNotificationsType;
let countUnreadRomanceNotifications: typeof CountUnreadRomanceNotificationsType;
let markRomanceNotificationRead: typeof MarkRomanceNotificationReadType;
let markAllRomanceNotificationsRead: typeof MarkAllRomanceNotificationsReadType;

let playerAId: string;
let playerBId: string;

before(async () => {
  process.env.DATABASE_URL = INTEGRATION_DATABASE_URL;
  process.env.DIRECT_URL = process.env.INTEGRATION_DIRECT_URL ?? INTEGRATION_DATABASE_URL;

  execSync("npx prisma migrate deploy", { stdio: "inherit", env: process.env });

  const prismaModule = await import("../../src/lib/prisma");
  prisma = prismaModule.prisma;

  const auditModule = await import("../../src/features/romance/audit/romance-audit.service");
  recordRomanceAuditEvent = auditModule.recordRomanceAuditEvent;
  listRomanceAuditLogs = auditModule.listRomanceAuditLogs;

  const notificationModule = await import(
    "../../src/features/romance/notifications/romance-notification.service"
  );
  createRomanceNotification = notificationModule.createRomanceNotification;
  listRomanceNotifications = notificationModule.listRomanceNotifications;
  countUnreadRomanceNotifications = notificationModule.countUnreadRomanceNotifications;
  markRomanceNotificationRead = notificationModule.markRomanceNotificationRead;
  markAllRomanceNotificationsRead = notificationModule.markAllRomanceNotificationsRead;

  const [playerA, playerB] = await Promise.all([
    prisma.romancePlayer.create({
      data: { userId: `user-${RUN_ID}-a`, displayName: "Player A" },
    }),
    prisma.romancePlayer.create({
      data: { userId: `user-${RUN_ID}-b`, displayName: "Player B" },
    }),
  ]);
  playerAId = playerA.id;
  playerBId = playerB.id;
});

after(async () => {
  await prisma.romancePlayer.deleteMany({ where: { userId: { startsWith: `user-${RUN_ID}-` } } });
  await prisma.$disconnect();
});

test("recordRomanceAuditEvent writes a row readable via listRomanceAuditLogs", async () => {
  await recordRomanceAuditEvent({
    playerId: playerAId,
    actorType: "PLAYER",
    action: "bargain.sealed",
    resourceType: "StoryEvent",
    resourceId: "evt-1",
    metadata: { targetCharacterSlug: "caelan" },
  });

  const logs = await listRomanceAuditLogs(playerAId);
  assert.equal(logs.length, 1);
  assert.equal(logs[0]!.action, "bargain.sealed");
  assert.equal(logs[0]!.actorType, "PLAYER");
  assert.equal(logs[0]!.resourceId, "evt-1");
  assert.deepEqual(logs[0]!.metadata, { targetCharacterSlug: "caelan" });
});

test("listRomanceAuditLogs is tenant-scoped - player B never sees player A's events", async () => {
  const logsForB = await listRomanceAuditLogs(playerBId);
  assert.equal(logsForB.length, 0);
});

test("listRomanceAuditLogs can filter by resourceType", async () => {
  await recordRomanceAuditEvent({
    playerId: playerAId,
    actorType: "SYSTEM",
    action: "age_verification.completed",
    resourceType: "RomancePlayer",
    resourceId: playerAId,
  });

  const playerLogs = await listRomanceAuditLogs(playerAId, { resourceType: "RomancePlayer" });
  assert.equal(playerLogs.length, 1);
  assert.equal(playerLogs[0]!.action, "age_verification.completed");
});

test("createRomanceNotification writes a row, counted as unread, readable via listRomanceNotifications", async () => {
  await createRomanceNotification({
    playerId: playerAId,
    title: "A bargain is sealed",
    body: "You and Caelan have sealed a bargain.",
    payload: { storyEventId: "evt-1" },
  });

  const unreadCount = await countUnreadRomanceNotifications(playerAId);
  assert.equal(unreadCount, 1);

  const notifications = await listRomanceNotifications(playerAId);
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0]!.title, "A bargain is sealed");
  assert.equal(notifications[0]!.isRead, false);
});

test("markRomanceNotificationRead marks exactly that notification read and decrements the unread count", async () => {
  const notifications = await listRomanceNotifications(playerAId);
  const targetId = notifications[0]!.id;

  await markRomanceNotificationRead(playerAId, targetId);

  const updated = await prisma.romanceNotification.findUnique({ where: { id: targetId } });
  assert.equal(updated?.isRead, true);

  const unreadCount = await countUnreadRomanceNotifications(playerAId);
  assert.equal(unreadCount, 0);
});

test("markRomanceNotificationRead is tenant-scoped - player B can never mark player A's notification read", async () => {
  await createRomanceNotification({
    playerId: playerAId,
    title: "The story moves forward",
    body: "A new chapter begins: The Revelation.",
  });
  const notifications = await listRomanceNotifications(playerAId);
  const unreadForA = notifications.find((n) => !n.isRead);
  assert.ok(unreadForA, "expected an unread notification for player A");

  await markRomanceNotificationRead(playerBId, unreadForA!.id);

  const stillUnread = await prisma.romanceNotification.findUnique({
    where: { id: unreadForA!.id },
  });
  assert.equal(
    stillUnread?.isRead,
    false,
    "player B's call must not affect player A's notification"
  );
});

test("markAllRomanceNotificationsRead clears every unread notification for that player only", async () => {
  await createRomanceNotification({ playerId: playerBId, title: "Premium voices unlocked", body: "..." });
  await createRomanceNotification({ playerId: playerBId, title: "A chapter has ended", body: "..." });

  const unreadBefore = await countUnreadRomanceNotifications(playerBId);
  assert.equal(unreadBefore, 2);

  await markAllRomanceNotificationsRead(playerBId);

  const unreadAfter = await countUnreadRomanceNotifications(playerBId);
  assert.equal(unreadAfter, 0);

  // Player A's still-unread notification (from the tenant-isolation test
  // above) must be untouched by player B's mark-all-read call.
  const unreadForA = await countUnreadRomanceNotifications(playerAId);
  assert.equal(unreadForA, 1);
});
