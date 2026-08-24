import { describe, expect, it } from "vitest";
import "@/server/ai/tools/builtin"; // registers get_lead and the rest so the planner can validate against them
import { createPlan } from "@/server/ai/planner/planner";
import { PlannerValidationError } from "@/server/ai/planner/types";
import { MAX_PLAN_STEPS } from "@/server/ai/planner/schema";
import {
  createFakeProvider,
  createSequencedProvider,
  directAnswerResult,
  malformedPlanResult,
  planResult,
} from "./fake-provider";

describe("planner", () => {
  it("produces an ordered plan when the model proposes a valid propose_plan call", async () => {
    const provider = createFakeProvider(() =>
      planResult([
        { toolName: "get_lead", input: { leadId: "lead-1" }, rationale: "Look up the lead first." },
        {
          toolName: "record_lead_activity",
          input: { leadId: "lead-1", type: "ai_note", body: "Checked in." },
          rationale: "Leave a note.",
        },
      ]),
    );

    const plan = await createPlan({ goal: "Check on lead-1 and leave a note", provider, model: "gpt-4o" });

    expect(plan.directAnswer).toBeNull();
    expect(plan.steps).toHaveLength(2);
    expect(plan.steps[0]).toEqual({
      toolName: "get_lead",
      input: { leadId: "lead-1" },
      rationale: "Look up the lead first.",
    });
    expect(plan.steps[1]?.toolName).toBe("record_lead_activity");
  });

  it("falls back to a direct answer when the model decides no tool call is needed", async () => {
    const provider = createFakeProvider(() => directAnswerResult("You don't need to do anything here."));

    const plan = await createPlan({ goal: "What is a lead?", provider, model: "gpt-4o" });

    expect(plan.steps).toHaveLength(0);
    expect(plan.directAnswer).toBe("You don't need to do anything here.");
  });

  it("rejects a plan whose arguments don't match the propose_plan schema", async () => {
    const provider = createFakeProvider(() => malformedPlanResult());

    await expect(createPlan({ goal: "Do something", provider, model: "gpt-4o" })).rejects.toThrow(
      PlannerValidationError,
    );
  });

  it("rejects a plan that references a tool that isn't registered", async () => {
    const provider = createFakeProvider(() =>
      planResult([{ toolName: "delete_the_database", input: {}, rationale: "Oops." }]),
    );

    await expect(createPlan({ goal: "Do something destructive", provider, model: "gpt-4o" })).rejects.toThrow(
      /unknown tool/i,
    );
  });

  it("rejects a plan with more steps than the hard cap", async () => {
    const steps = Array.from({ length: MAX_PLAN_STEPS + 1 }, (_, i) => ({
      toolName: "get_lead",
      input: { leadId: `lead-${i}` },
      rationale: "Repeat lookup.",
    }));
    const provider = createFakeProvider(() => planResult(steps));

    await expect(createPlan({ goal: "Look up many leads", provider, model: "gpt-4o" })).rejects.toThrow(
      PlannerValidationError,
    );
  });

  it("retries once after an invalid plan and succeeds if the corrected response is valid", async () => {
    const provider = createSequencedProvider([
      malformedPlanResult(),
      planResult([{ toolName: "get_lead", input: { leadId: "lead-1" }, rationale: "Corrected on retry." }]),
    ]);

    const plan = await createPlan({ goal: "Check on lead-1", provider, model: "gpt-4o" });

    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0]?.toolName).toBe("get_lead");
  });

  it("retries once after a plan referencing an unknown tool and succeeds if corrected", async () => {
    const provider = createSequencedProvider([
      planResult([{ toolName: "delete_the_database", input: {}, rationale: "Oops." }]),
      planResult([{ toolName: "get_lead", input: { leadId: "lead-1" }, rationale: "Corrected on retry." }]),
    ]);

    const plan = await createPlan({ goal: "Check on lead-1", provider, model: "gpt-4o" });

    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0]?.toolName).toBe("get_lead");
  });

  it("gives up after the retry is also invalid, rather than looping forever", async () => {
    const provider = createSequencedProvider([malformedPlanResult(), malformedPlanResult()]);

    await expect(createPlan({ goal: "Do something", provider, model: "gpt-4o" })).rejects.toThrow(
      PlannerValidationError,
    );
  });

  it("sums token usage across the initial attempt and the retry", async () => {
    const provider = createSequencedProvider([
      { ...malformedPlanResult(), usage: { inputTokens: 100, outputTokens: 20 } },
      {
        ...planResult([{ toolName: "get_lead", input: { leadId: "lead-1" }, rationale: "Corrected." }]),
        usage: { inputTokens: 150, outputTokens: 30 },
      },
    ]);

    const plan = await createPlan({ goal: "Check on lead-1", provider, model: "gpt-4o" });

    expect(plan.usage).toEqual({ inputTokens: 250, outputTokens: 50 });
  });
});
