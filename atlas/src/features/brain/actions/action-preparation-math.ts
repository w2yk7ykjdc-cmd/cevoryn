/**
 * Pure action-candidate selection, split out of action-preparer.ts so it's
 * testable without that file's server-only AI/DB dependencies.
 */

import { toActionType } from "@/lib/enum-validators";

export interface RawAction {
  type: string;
  title: string;
  description: string;
  content: Record<string, unknown>;
}

export type ActionType =
  "EMAIL_DRAFT" | "TASK" | "CALENDAR_PROPOSAL" | "FOLLOW_UP";

export interface ActionCandidate {
  type: ActionType;
  title: string;
  description: string;
  content: Record<string, unknown>;
  dedupeKey: string;
}

const MAX_ACTIONS = 3;

/**
 * Validate, normalize, and dedupe raw AI-proposed actions. Caps at
 * MAX_ACTIONS and drops anything with a missing title, an unrecognized
 * type, or a (type, title) pair already seen earlier in the same batch.
 */
export function selectActionCandidates(rawActions: unknown): ActionCandidate[] {
  if (!Array.isArray(rawActions)) return [];

  const candidates: ActionCandidate[] = [];
  const generatedKeys = new Set<string>();

  for (const action of rawActions.slice(0, MAX_ACTIONS) as RawAction[]) {
    const title = action?.title?.trim();
    const type = toActionType(action?.type);
    if (!title || !type) continue;

    const dedupeKey = `${type}:${title.toLocaleLowerCase("en-US")}`;
    if (generatedKeys.has(dedupeKey)) continue;
    generatedKeys.add(dedupeKey);

    candidates.push({
      type,
      title,
      description: action.description || "",
      content: action.content || {},
      dedupeKey,
    });
  }

  return candidates;
}
