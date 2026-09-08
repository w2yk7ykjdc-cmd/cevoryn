"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { AutonomyLevel } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  disengageKillSwitchAction,
  engageKillSwitchAction,
  updateAutonomyPolicyAction,
} from "@/app/(dashboard)/dashboard/settings/autonomy/actions";

const LEVELS: { value: AutonomyLevel; label: string; description: string }[] = [
  { value: "L0", label: "L0 — Disabled", description: "No mutating tool call runs for this domain, ever." },
  { value: "L1", label: "L1 — Read-only", description: "Reads and analysis only; no mutating tool call runs." },
  { value: "L2", label: "L2 — Standard (default)", description: "Additive writes run automatically; everything else asks for approval." },
  { value: "L3", label: "L3 — Approval-gated mutation", description: "Any mutating tool may reach the approval queue; still always asks a human." },
  { value: "L4", label: "L4 — Bounded autonomous", description: "Explicitly allowlisted, low-risk tools run unattended within daily limits." },
  { value: "L5", label: "L5 — Scheduled/event autonomous", description: "Same as L4, plus the recurring scheduler may trigger it (not yet wired up)." },
];

type PolicyState = {
  level: AutonomyLevel;
  dailyActionLimit: number;
  dailyRiskLimit: number;
  perActionRiskLimit: number;
  killSwitchEngaged: boolean;
};

export function AutonomyClient({ domain, initialPolicy }: { domain: string; initialPolicy: PolicyState }) {
  const router = useRouter();
  const [policy, setPolicy] = useState(initialPolicy);
  const [form, setForm] = useState(initialPolicy);
  const [isSaving, setIsSaving] = useState(false);
  const [isTogglingKillSwitch, setIsTogglingKillSwitch] = useState(false);

  async function handleSave(event: React.FormEvent) {
    event.preventDefault();
    setIsSaving(true);
    const result = await updateAutonomyPolicyAction({
      level: form.level,
      dailyActionLimit: form.dailyActionLimit,
      dailyRiskLimit: form.dailyRiskLimit,
      perActionRiskLimit: form.perActionRiskLimit,
    });
    setIsSaving(false);

    if (!result.success) {
      toast.error(result.error);
      return;
    }
    setPolicy((prev) => ({ ...prev, ...form }));
    toast.success("Autonomy policy updated");
    router.refresh();
  }

  async function handleKillSwitchToggle() {
    setIsTogglingKillSwitch(true);
    const result = policy.killSwitchEngaged ? await disengageKillSwitchAction() : await engageKillSwitchAction();
    setIsTogglingKillSwitch(false);

    if (!result.success) {
      toast.error(result.error);
      return;
    }
    setPolicy((prev) => ({ ...prev, killSwitchEngaged: !prev.killSwitchEngaged }));
    toast.success(policy.killSwitchEngaged ? "Kill switch disengaged" : "Kill switch engaged");
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-6">
      <Card className={policy.killSwitchEngaged ? "border-destructive" : undefined}>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base">Kill switch — {domain}</CardTitle>
              <CardDescription>
                Immediately blocks every new mutating action for this domain, regardless of the level below. Never
                cached — takes effect on the very next tool call.
              </CardDescription>
            </div>
            <Badge variant={policy.killSwitchEngaged ? "destructive" : "secondary"}>
              {policy.killSwitchEngaged ? "Engaged" : "Off"}
            </Badge>
          </div>
        </CardHeader>
        <CardFooter>
          <Button
            type="button"
            variant={policy.killSwitchEngaged ? "outline" : "destructive"}
            disabled={isTogglingKillSwitch}
            onClick={handleKillSwitchToggle}
          >
            {isTogglingKillSwitch ? "Working…" : policy.killSwitchEngaged ? "Disengage kill switch" : "Engage kill switch"}
          </Button>
        </CardFooter>
      </Card>

      <Card className="max-w-xl">
        <CardHeader>
          <CardTitle className="text-base">Policy — {domain}</CardTitle>
          <CardDescription>
            Daily limits are structurally inert at 0 — L4/L5 will never run unattended until raised above zero.
          </CardDescription>
        </CardHeader>
        <form onSubmit={handleSave}>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label>Autonomy level</Label>
              <Select value={form.level} onValueChange={(value) => setForm((prev) => ({ ...prev, level: value as AutonomyLevel }))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LEVELS.map((l) => (
                    <SelectItem key={l.value} value={l.value}>
                      {l.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">{LEVELS.find((l) => l.value === form.level)?.description}</p>
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="daily-action-limit">Daily action limit (L4/L5 only)</Label>
              <Input
                id="daily-action-limit"
                type="number"
                min={0}
                value={form.dailyActionLimit}
                onChange={(e) => setForm((prev) => ({ ...prev, dailyActionLimit: Number(e.target.value) }))}
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="daily-risk-limit">Daily risk budget, $ (L4/L5 only)</Label>
              <Input
                id="daily-risk-limit"
                type="number"
                min={0}
                step="0.01"
                value={form.dailyRiskLimit}
                onChange={(e) => setForm((prev) => ({ ...prev, dailyRiskLimit: Number(e.target.value) }))}
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="per-action-risk-limit">Per-action risk cap, $ (L4/L5 only)</Label>
              <Input
                id="per-action-risk-limit"
                type="number"
                min={0}
                step="0.01"
                value={form.perActionRiskLimit}
                onChange={(e) => setForm((prev) => ({ ...prev, perActionRiskLimit: Number(e.target.value) }))}
              />
            </div>
          </CardContent>
          <CardFooter>
            <Button type="submit" disabled={isSaving}>
              {isSaving ? "Saving…" : "Save policy"}
            </Button>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
}
