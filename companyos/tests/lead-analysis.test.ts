import { describe, expect, it } from "vitest";
import { analyzeLead } from "@/server/leads/analysis";

const NOW = new Date("2026-07-31T12:00:00Z");

function daysAgo(days: number): Date {
  return new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000);
}

const baseLead = {
  title: "Acme Renewal",
  value: 50000,
  probability: 60,
  createdAt: daysAgo(20),
  stage: { name: "Proposal", isWon: false, isLost: false },
};

describe("analyzeLead", () => {
  it("flags a lead with no recent activity as high risk and suggests a follow-up", () => {
    const analysis = analyzeLead(
      { ...baseLead, activities: [{ createdAt: daysAgo(10) }], tasks: [] },
      NOW,
    );

    expect(analysis.daysSinceLastActivity).toBe(10);
    expect(analysis.riskLevel).toBe("high");
    expect(analysis.suggestedNextAction).toMatch(/follow up/i);
  });

  it("flags overdue tasks as the top-priority action, ahead of staleness", () => {
    const analysis = analyzeLead(
      {
        ...baseLead,
        activities: [{ createdAt: daysAgo(10) }],
        tasks: [{ status: "todo", dueDate: daysAgo(2) }],
      },
      NOW,
    );

    expect(analysis.overdueTaskCount).toBe(1);
    expect(analysis.riskLevel).toBe("high");
    expect(analysis.suggestedNextAction).toMatch(/overdue/i);
  });

  it("suggests scheduling a next step when there is recent activity but no open tasks", () => {
    const analysis = analyzeLead(
      { ...baseLead, activities: [{ createdAt: daysAgo(1) }], tasks: [] },
      NOW,
    );

    expect(analysis.riskLevel).toBe("low");
    expect(analysis.suggestedNextAction).toMatch(/no open tasks/i);
  });

  it("treats a lead with an open, non-overdue task and recent activity as on track", () => {
    const analysis = analyzeLead(
      {
        ...baseLead,
        activities: [{ createdAt: daysAgo(1) }],
        tasks: [{ status: "todo", dueDate: daysAgo(-5) }],
      },
      NOW,
    );

    expect(analysis.riskLevel).toBe("low");
    expect(analysis.suggestedNextAction).toMatch(/on track/i);
  });

  it("does not suggest action on a closed (won) deal, regardless of staleness", () => {
    const analysis = analyzeLead(
      {
        ...baseLead,
        stage: { name: "Won", isWon: true, isLost: false },
        activities: [{ createdAt: daysAgo(30) }],
        tasks: [],
      },
      NOW,
    );

    expect(analysis.riskLevel).toBe("low");
    expect(analysis.suggestedNextAction).toMatch(/won/i);
  });

  it("falls back to the lead's creation date when there is no activity yet", () => {
    const analysis = analyzeLead({ ...baseLead, createdAt: daysAgo(5), activities: [], tasks: [] }, NOW);
    expect(analysis.daysSinceLastActivity).toBe(5);
  });
});
