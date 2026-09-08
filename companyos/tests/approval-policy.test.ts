import { describe, expect, it } from "vitest";
import { classifyToolRisk } from "@/server/ai/approval/policy";

describe("approval policy", () => {
  it("classifies read-only and append-only tools as auto", () => {
    expect(classifyToolRisk("get_lead")).toBe("auto");
    expect(classifyToolRisk("analyze_lead")).toBe("auto");
    expect(classifyToolRisk("search_leads")).toBe("auto");
    expect(classifyToolRisk("search_audit_log")).toBe("auto");
    expect(classifyToolRisk("search_memory")).toBe("auto");
    expect(classifyToolRisk("remember_fact")).toBe("auto");
    expect(classifyToolRisk("record_lead_activity")).toBe("auto");
    expect(classifyToolRisk("get_company_health")).toBe("auto");
    expect(classifyToolRisk("get_opportunities")).toBe("auto");
    expect(classifyToolRisk("get_risks")).toBe("auto");
  });

  it("classifies create_task, which assigns real work to a person, as requiring approval", () => {
    expect(classifyToolRisk("create_task")).toBe("requires_approval");
  });

  it("fails closed: an unrecognized tool name requires approval", () => {
    expect(classifyToolRisk("some_future_tool_nobody_has_classified_yet")).toBe("requires_approval");
  });
});
