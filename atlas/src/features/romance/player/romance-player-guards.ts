import "server-only";

import type { RomancePlayer } from "@prisma/client";
import { redirect } from "next/navigation";

import { getUser, requireUser } from "@/lib/auth";
import { ROUTES } from "@/lib/constants";
import type { AuthUser } from "@/types";

import { ensureRomancePlayer, isAdultVerified } from "./romance-player.service";


/**
 * Auth-boundary functions for pages and server actions. Separate from
 * romance-player.service.ts specifically because this file imports
 * `next/navigation`/`@/lib/auth`, which cannot load outside a real
 * Next.js runtime - importing it from a plain integration test crashes
 * at module load time, before any test even runs. Pages/actions (which
 * always run inside Next.js) import from here; tests import the pure
 * data layer directly instead.
 *
 * The age gate is a first-class server-side check, never a UI
 * affordance: every page AND every server action that touches Romance
 * story content calls one of the functions below before doing anything
 * else, so there is no code path - button hidden or not, direct action
 * call or not - that reaches story content without it.
 */

export class RomanceNotAuthenticatedError extends Error {
  constructor() {
    super("Authentication is required.");
    this.name = "RomanceNotAuthenticatedError";
  }
}

export class RomanceAgeNotVerifiedError extends Error {
  constructor() {
    super("18+ age verification is required before accessing story content.");
    this.name = "RomanceAgeNotVerifiedError";
  }
}

/**
 * For Server Components (pages/layouts). Redirects - never silently
 * renders protected content. Unauthenticated -> /login (via
 * requireUser()); authenticated but not age-verified -> the age gate.
 */
export async function requireAdultRomancePlayer(): Promise<{
  user: AuthUser;
  player: RomancePlayer;
}> {
  const user = await requireUser();
  const player = await ensureRomancePlayer(user.id, user.email);

  if (!isAdultVerified(player)) {
    redirect(ROUTES.ROMANCE_AGE_GATE);
  }

  return { user, player };
}

/**
 * For Server Components that must render even when unverified (the age
 * gate page itself) - authenticates but does not enforce verification.
 */
export async function requireRomancePlayer(): Promise<{
  user: AuthUser;
  player: RomancePlayer;
}> {
  const user = await requireUser();
  const player = await ensureRomancePlayer(user.id, user.email);
  return { user, player };
}

/**
 * For server actions - throws typed errors instead of redirecting, so a
 * direct action invocation (bypassing the UI entirely, e.g. a crafted
 * fetch to the action's endpoint) gets a safe rejection rather than a
 * Next.js redirect response the caller could misinterpret as success.
 * This is the check that makes the age gate real: it runs on every
 * mutating/reading Romance action, not just on the page route.
 */
export async function getAdultRomancePlayerOrThrow(): Promise<{
  user: AuthUser;
  player: RomancePlayer;
}> {
  const user = await getUser();
  if (!user) throw new RomanceNotAuthenticatedError();

  const player = await ensureRomancePlayer(user.id, user.email);
  if (!isAdultVerified(player)) throw new RomanceAgeNotVerifiedError();

  return { user, player };
}
