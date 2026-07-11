"use server";

import { revalidatePath } from "next/cache";

import { requireMembership, requireUser } from "@/lib/auth";
import { ROUTES } from "@/lib/constants";
import {
  createConversation,
  deleteConversation,
  renameConversation,
} from "@/server/services/conversation.service";
import type { ActionResult } from "@/types";

import {
  createConversationSchema,
  deleteConversationSchema,
  renameConversationSchema,
} from "../schemas/conversation";
import type {
  CreateConversationInput,
  DeleteConversationInput,
  RenameConversationInput,
} from "../schemas/conversation";

export async function createConversationAction(
  input: CreateConversationInput
): Promise<ActionResult<{ id: string }>> {
  const user = await requireUser();
  const membership = await requireMembership(user.id);

  const parsed = createConversationSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: "Invalid input" };
  }

  try {
    const conversation = await createConversation({
      organizationId: membership.organizationId,
      createdById: membership.userId,
      title: parsed.data.title,
    });

    revalidatePath(ROUTES.CHAT);

    return { success: true, data: { id: conversation.id } };
  } catch (_error) {
    return { success: false, error: "Failed to create conversation" };
  }
}

export async function renameConversationAction(
  input: RenameConversationInput
): Promise<ActionResult> {
  const user = await requireUser();
  const membership = await requireMembership(user.id);

  const parsed = renameConversationSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: "Invalid input" };
  }

  try {
    await renameConversation(
      parsed.data.id,
      membership.organizationId,
      parsed.data.title
    );

    revalidatePath(ROUTES.CHAT);

    return { success: true, data: undefined };
  } catch (_error) {
    return { success: false, error: "Failed to rename conversation" };
  }
}

export async function deleteConversationAction(
  input: DeleteConversationInput
): Promise<ActionResult> {
  const user = await requireUser();
  const membership = await requireMembership(user.id);

  const parsed = deleteConversationSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: "Invalid input" };
  }

  try {
    await deleteConversation(parsed.data.id, membership.organizationId);

    revalidatePath(ROUTES.CHAT);

    return { success: true, data: undefined };
  } catch (_error) {
    return { success: false, error: "Failed to delete conversation" };
  }
}
