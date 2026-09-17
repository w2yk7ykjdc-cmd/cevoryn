import "server-only";

import { createPreparedAction } from "@/features/brain/actions/action.service";
import { prisma } from "@/lib/prisma";

/**
 * Bridges Radar's Opportunity Engine into the existing Brain PreparedAction
 * pipeline (createPreparedAction/updateActionStatus/recordActionExecution -
 * all unchanged, reused as-is). Deliberately NOT a second action system:
 * this only decides *whether and what* to prepare from an Opportunity, then
 * hands off to the same createPreparedAction() Insight-sourced actions
 * already use, so approval/dismissal/execution/idempotency all continue to
 * go through the one real PreparedAction lifecycle.
 *
 * No LLM call here - Opportunity.recommendedAction is already LLM-produced
 * text (see opportunity-generator.ts's OPPORTUNITY_PROMPT). It is stored
 * verbatim as the action's content/description, exactly like an
 * Insight-sourced action already stores LLM-generated content verbatim
 * (action-preparer.ts). This is not a new trust boundary: the text is
 * never interpreted as an instruction anywhere - it is only ever displayed
 * to a human who must explicitly approve it (PENDING -> APPROVED) before
 * any execution channel (clipboard/mailto/calendar) acts on it, the exact
 * same human-approval gate every other PreparedAction already requires.
 */
export type PrepareActionFromOpportunityResult =
  | { outcome: "created"; actionId: string }
  | { outcome: "already_exists"; actionId: string }
  | { outcome: "not_found" }
  | { outcome: "no_recommended_action" };

export async function prepareActionFromOpportunity(
  organizationId: string,
  opportunityId: string
): Promise<PrepareActionFromOpportunityResult> {
  const opportunity = await prisma.opportunity.findFirst({
    where: { id: opportunityId, organizationId },
    select: {
      id: true,
      title: true,
      recommendedAction: true,
      confidence: true,
    },
  });
  if (!opportunity) return { outcome: "not_found" };

  if (!opportunity.recommendedAction.trim()) {
    return { outcome: "no_recommended_action" };
  }

  // Idempotent: an Opportunity that already has a non-dismissed prepared
  // action returns that existing action instead of creating a duplicate.
  // Mirrors the (type, title, PENDING) dedup check action-preparer.ts's
  // prepareActionsFromInsight already uses per candidate - here there is
  // only ever one candidate per Opportunity (the single recommendedAction
  // string), so the dedup key is simply sourceOpportunityId itself.
  const existing = await prisma.preparedAction.findFirst({
    where: {
      organizationId,
      sourceOpportunityId: opportunityId,
      status: { not: "DISMISSED" },
    },
    select: { id: true },
    orderBy: { createdAt: "desc" },
  });
  if (existing) return { outcome: "already_exists", actionId: existing.id };

  const action = await createPreparedAction({
    organizationId,
    type: "TASK",
    title: opportunity.title,
    description: opportunity.recommendedAction,
    content: {
      title: opportunity.title,
      description: opportunity.recommendedAction,
    },
    sourceOpportunityId: opportunity.id,
    confidence: opportunity.confidence,
    reasoning: `Prepared from Radar opportunity "${opportunity.title}".`,
  });

  return { outcome: "created", actionId: action.id };
}
