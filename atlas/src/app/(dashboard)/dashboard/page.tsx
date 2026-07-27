import type { Metadata } from "next";

import { loadExecutiveHome } from "@/features/executive/services/executive-home.service";
import { requireMembership, requireUser } from "@/lib/auth";

import { ExecutiveHomeClient } from "./executive-home-client";

export const metadata: Metadata = { title: "CEVORYN — Executive Home" };

/**
 * Executive Home — server component.
 * Loads all brain data in a single server call, then passes to client.
 * No waterfalls, no duplicate fetches, no secrets exposed.
 */
export default async function DashboardPage() {
  const user = await requireUser();
  const membership = await requireMembership(user.id);

  const data = await loadExecutiveHome(membership);

  return <ExecutiveHomeClient data={data} />;
}
