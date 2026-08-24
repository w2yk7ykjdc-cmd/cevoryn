"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/server/auth/session";
import { createApiKey, revokeApiKey } from "@/server/api-keys/service";
import { API_KEY_SCOPES } from "@/server/api-keys/types";
import type { ActionResult } from "@/app/(dashboard)/dashboard/members/actions";

export type CreateApiKeyResult = { success: true; plaintextKey: string } | { success: false; error: string };

/** v1: every key is granted every currently-defined scope — there's only one (ai:chat) so there's nothing meaningful to pick yet. */
export async function createApiKeyAction(input: { name: string }): Promise<CreateApiKeyResult> {
  const { session, organization } = await requirePermission({ apiKey: ["create"] });

  const name = input.name.trim();
  if (!name) {
    return { success: false, error: "Name is required" };
  }

  try {
    const { plaintextKey } = await createApiKey({
      organizationId: organization.id,
      actorId: session.user.id,
      name,
      scopes: [...API_KEY_SCOPES],
    });
    revalidatePath("/dashboard/settings/api-keys");
    return { success: true, plaintextKey };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Failed to create API key" };
  }
}

export async function revokeApiKeyAction(apiKeyId: string): Promise<ActionResult> {
  const { session, organization } = await requirePermission({ apiKey: ["revoke"] });

  try {
    await revokeApiKey(organization.id, apiKeyId, session.user.id);
    revalidatePath("/dashboard/settings/api-keys");
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Failed to revoke API key" };
  }
}
