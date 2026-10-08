import "server-only";

import { Prisma, type RomanceSubscription } from "@prisma/client";

import {
  getRomancePlanFromPolarProductId,
  mapPolarStatusToRomanceStatus,
  parseDate,
  type PolarSubscriptionEvent,
} from "@/lib/polar/mapping";
import { prisma } from "@/lib/prisma";

import { recordRomanceAuditEvent } from "../audit/romance-audit.service";
import { createRomanceNotification } from "../notifications/romance-notification.service";

/**
 * Romance's own billing-state service (ADR-0001: `RomanceSubscription` is
 * a separate table from Cevoryn's org-scoped `Subscription`, keyed by
 * `playerId` not `organizationId`). Mirrors billing.service.ts's
 * applyPolarSubscriptionEvent() pattern deliberately - same provider
 * (Polar), same webhook-event-claiming/out-of-order-redelivery defense,
 * same "one atomic statement, no separate read-then-write race" shape -
 * just a different target table and a narrower plan/status model (FREE/
 * PREMIUM, ACTIVE/CANCELED/EXPIRED vs the B2B STARTER/PROFESSIONAL/
 * BUSINESS and 8-value SubscriptionStatus).
 */

export async function getRomanceSubscription(
  playerId: string
): Promise<RomanceSubscription | null> {
  return prisma.romanceSubscription.findUnique({ where: { playerId } });
}

export interface ApplyPolarRomanceEventResult {
  /** false when this event_id was already claimed by an earlier delivery. */
  processed: boolean;
  /** false when processed but skipped as an out-of-order/stale event. */
  applied: boolean;
}

/**
 * Idempotently records a Polar subscription webhook event for a Romance
 * player and, if it's the newest one seen for this subscription, upserts
 * the player's RomanceSubscription row. The caller (the shared Polar
 * webhook route) is responsible for signature verification, event-type
 * filtering, and routing an event here only when its metadata carries a
 * `romancePlayerId` (as opposed to the B2B path's `organizationId`).
 */
export async function applyPolarRomanceSubscriptionEvent(
  eventId: string,
  event: PolarSubscriptionEvent
): Promise<ApplyPolarRomanceEventResult> {
  let appliedRomancePlayerId: string | null = null;
  let appliedStatus: string | null = null;

  const result = await prisma.$transaction(async (transaction) => {
    const claimed = await transaction.$executeRaw(Prisma.sql`
      INSERT INTO "billing_webhook_events" ("provider", "event_id", "event_type")
      VALUES ('polar', ${eventId}, ${event.type})
      ON CONFLICT ("provider", "event_id") DO NOTHING
    `);
    if (claimed === 0) return { processed: false, applied: false };

    const romancePlayerId = event.data.metadata?.romancePlayerId;
    const productId = event.data.product_id;
    const plan = productId ? getRomancePlanFromPolarProductId(productId) : null;

    if (
      typeof romancePlayerId !== "string" ||
      !event.data.id ||
      !event.data.customer_id ||
      !productId ||
      !plan
    ) {
      throw new Error(
        "Polar Romance subscription event is missing romancePlayerId metadata or references an unknown product."
      );
    }

    const eventTimestamp = parseDate(event.timestamp);
    const status = mapPolarStatusToRomanceStatus(event.data.status);
    appliedRomancePlayerId = romancePlayerId;
    appliedStatus = status;

    // Same out-of-order-redelivery guard as billing.service.ts's
    // applyPolarSubscriptionEvent(): only blocks the update when we have
    // positive evidence the incoming event is older than what's already
    // stored, never when either side lacks a timestamp.
    const updateResult = await transaction.$executeRaw(Prisma.sql`
      INSERT INTO "romance_subscriptions" (
        "id", "player_id", "plan", "status", "provider", "provider_customer_id",
        "current_period_end", "last_webhook_event_at", "updated_at"
      ) VALUES (
        ${crypto.randomUUID()}, ${romancePlayerId},
        ${plan}::"RomanceSubscriptionPlan", ${status}::"RomanceSubscriptionStatus",
        'polar', ${event.data.customer_id},
        ${parseDate(event.data.current_period_end)},
        ${eventTimestamp}, CURRENT_TIMESTAMP
      )
      ON CONFLICT ("player_id") DO UPDATE SET
        "plan" = EXCLUDED."plan",
        "status" = EXCLUDED."status",
        "provider" = EXCLUDED."provider",
        "provider_customer_id" = EXCLUDED."provider_customer_id",
        "current_period_end" = EXCLUDED."current_period_end",
        "last_webhook_event_at" = EXCLUDED."last_webhook_event_at",
        "updated_at" = CURRENT_TIMESTAMP
      WHERE
        "romance_subscriptions"."last_webhook_event_at" IS NULL
        OR EXCLUDED."last_webhook_event_at" IS NULL
        OR EXCLUDED."last_webhook_event_at" >= "romance_subscriptions"."last_webhook_event_at"
    `);

    return { processed: true, applied: updateResult > 0 };
  });

  // Outside the transaction on purpose - these are non-critical,
  // best-effort side effects (audit trail + in-app notification), never
  // worth holding the subscription-state transaction open for, and
  // never allowed to fail the webhook's actual job (recording state).
  if (result.applied && appliedRomancePlayerId) {
    await recordRomanceAuditEvent({
      playerId: appliedRomancePlayerId,
      actorType: "SYSTEM",
      action: "subscription.updated",
      resourceType: "RomanceSubscription",
      metadata: { eventType: event.type, status: appliedStatus },
    });
    // Only the two events that represent an actual new activation, not
    // every subsequent event that happens to reconfirm ACTIVE (e.g.
    // subscription.updated can fire for unrelated field changes) - this
    // notification would otherwise repeat on every webhook delivery.
    if (
      appliedStatus === "ACTIVE" &&
      (event.type === "subscription.created" || event.type === "subscription.active")
    ) {
      await createRomanceNotification({
        playerId: appliedRomancePlayerId,
        title: "Premium voices unlocked",
        body: "Your Premium subscription is active - dialogue from your voiced characters will now be performed as audio.",
        payload: { eventType: event.type },
      });
    }
  }

  return result;
}
