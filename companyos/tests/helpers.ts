import { randomUUID } from "node:crypto";
import { auth } from "@/server/auth/auth";
import { prisma } from "@/server/db/client";
import { shutdownEventBus } from "@/server/events/event-bus";
import type { OrganizationRoleName } from "@/server/auth/permissions";

export function uniqueEmail(prefix = "test"): string {
  return `${prefix}-${randomUUID()}@example.com`;
}

export function uniqueSlug(prefix = "org"): string {
  return `${prefix}-${randomUUID().slice(0, 8)}`;
}

export type TestUser = {
  token: string;
  userId: string;
  email: string;
  password: string;
};

/** Creates a real user via the sign-up endpoint and returns a bearer token for it. */
export async function signUpUser(overrides?: {
  email?: string;
  name?: string;
  password?: string;
}): Promise<TestUser> {
  const email = overrides?.email ?? uniqueEmail();
  const name = overrides?.name ?? "Test User";
  const password = overrides?.password ?? "password12345";

  const result = await auth.api.signUpEmail({ body: { email, name, password } });
  if (!result.token) {
    throw new Error("sign-up did not return a session token");
  }

  return { token: result.token, userId: result.user.id, email, password };
}

/** Headers a real authenticated request would carry (bearer plugin honors this). */
export function authHeaders(token: string): Headers {
  return new Headers({ authorization: `Bearer ${token}` });
}

/** Creates an organization owned by `owner`; Better Auth auto-assigns the owner role and active org. */
export async function createOrgForUser(
  owner: TestUser,
  overrides?: { name?: string; slug?: string },
) {
  const organization = await auth.api.createOrganization({
    headers: authHeaders(owner.token),
    body: {
      name: overrides?.name ?? "Test Org",
      slug: overrides?.slug ?? uniqueSlug(),
    },
  });
  if (!organization) {
    throw new Error("organization creation failed");
  }
  return organization;
}

/**
 * Adds `user` to `organizationId` with `role` directly (server-only endpoint,
 * bypasses the invitation flow) — for test setup only.
 */
export async function addMemberDirect(
  organizationId: string,
  user: TestUser,
  role: OrganizationRoleName,
) {
  return auth.api.addMember({
    body: { organizationId, userId: user.userId, role },
  });
}

/** Closes the DB/Redis connections opened during a test file's run, so vitest can exit cleanly. */
export async function closeTestConnections(): Promise<void> {
  await Promise.all([prisma.$disconnect(), shutdownEventBus()]);
}

type PaperPositionStatus = "PENDING" | "OPEN" | "CLOSED" | "STOPPED" | "TAKE_PROFIT" | "LIQUIDATED" | "INVALIDATED";
type PaperPositionDirection = "LONG" | "SHORT";
type PaperPositionMode = "SPOT" | "PERPETUAL_SIMULATION";

let tradeCounter = 0;

/**
 * Directly creates a fully-formed, already-closed `PaperTrade` row --
 * bypassing the full Sprint 16 simulation pipeline (whose price movements
 * are hard to control precisely enough to hit exact `returnPct`/
 * `closeReason` combinations deterministically). Shared between the
 * Sprint 17 and Sprint 18 test suites (both need the same precise control
 * over closed-trade fixtures) -- introduced in Sprint 17, promoted here in
 * Sprint 18 rather than duplicated a second time. `positionId` carries no
 * foreign key to a real `PaperPosition` row (confirmed against the Sprint
 * 16 migration SQL -- only `organizationId` is a real FK), so a synthetic
 * unique value is sufficient.
 */
export async function createClosedPaperTrade(
  organizationId: string,
  overrides: Partial<{
    symbol: string;
    strategyType: string;
    direction: PaperPositionDirection;
    mode: PaperPositionMode;
    strategySignalId: string | null;
    regime: string | null;
    candidateScore: number | null;
    candidateConfidence: number | null;
    leverage: number;
    entryPrice: number;
    exitPrice: number;
    quantity: number;
    notional: number;
    initialMargin: number;
    feesPaid: number;
    fundingPaid: number;
    netPnl: number;
    returnPct: number;
    maxFavorableExcursion: number;
    maxAdverseExcursion: number;
    closeReason: PaperPositionStatus;
    openedAt: Date;
    closedAt: Date;
  }> = {},
) {
  tradeCounter += 1;
  const entryPrice = overrides.entryPrice ?? 100;
  const initialMargin = overrides.initialMargin ?? 1000;
  const returnPct = overrides.returnPct ?? 0;
  const netPnl = overrides.netPnl ?? returnPct * initialMargin;
  const openedAt = overrides.openedAt ?? new Date(Date.now() - 60 * 60 * 1000);
  const closedAt = overrides.closedAt ?? new Date();

  return prisma.paperTrade.create({
    data: {
      organizationId,
      positionId: `test-position-${tradeCounter}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      symbol: overrides.symbol ?? "BTCUSDT",
      direction: overrides.direction ?? "LONG",
      mode: overrides.mode ?? "PERPETUAL_SIMULATION",
      strategyType: overrides.strategyType ?? "TREND_FOLLOWING",
      strategySignalId: overrides.strategySignalId ?? null,
      regime: overrides.regime === undefined ? "trending" : overrides.regime,
      candidateScore: overrides.candidateScore === undefined ? 80 : overrides.candidateScore,
      candidateConfidence: overrides.candidateConfidence === undefined ? 90 : overrides.candidateConfidence,
      leverage: overrides.leverage ?? 1,
      entryPrice,
      exitPrice: overrides.exitPrice ?? entryPrice,
      quantity: overrides.quantity ?? 10,
      notional: overrides.notional ?? 1000,
      initialMargin,
      grossPnl: netPnl,
      feesPaid: overrides.feesPaid ?? 0,
      fundingPaid: overrides.fundingPaid ?? 0,
      netPnl,
      returnPct,
      maxFavorableExcursion: overrides.maxFavorableExcursion ?? Math.max(0, netPnl),
      maxAdverseExcursion: overrides.maxAdverseExcursion ?? Math.min(0, netPnl),
      closeReason: overrides.closeReason ?? "CLOSED",
      openedAt,
      closedAt,
    },
  });
}
