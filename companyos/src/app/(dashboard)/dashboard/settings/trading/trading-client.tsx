"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { RiskPolicyLimits } from "@/server/execution/risk-policy";
import {
  configureCredentialsAction,
  disengageMarketKillSwitchAction,
  engageMarketKillSwitchAction,
  reactivateStrategyAction,
  revokeCredentialsAction,
  setExecutionAutonomyAction,
  updateRiskPolicyAction,
} from "@/app/(dashboard)/dashboard/settings/trading/actions";

type MarketKillSwitch = { engaged: boolean; canEngage: boolean; canDisengage: boolean } | null;
type ExecutionAutonomy = { enabled: boolean; enabledAt: Date | null; disabledAt: Date | null; canManage: boolean } | null;
type CredentialStatus = { provider: string; configured: boolean; fingerprint: string | null; rotatedAt: Date | null; revokedAt: Date | null };
type Credentials = { statuses: CredentialStatus[]; canManage: boolean; canRevoke: boolean } | null;
type StrategyHealthRow = { strategyType: string; status: string; evaluationScoreAtLastCheck: number | null; reason: string | null; lastCheckedAt: Date | null };
type StrategyHealth = { rows: StrategyHealthRow[]; canManage: boolean } | null;

export function TradingClient({
  supportedProviders,
  riskPolicyFieldKeys,
  marketKillSwitch,
  executionAutonomy,
  riskPolicy,
  credentials,
  strategyHealth,
}: {
  supportedProviders: string[];
  riskPolicyFieldKeys: (keyof RiskPolicyLimits)[];
  marketKillSwitch: MarketKillSwitch;
  executionAutonomy: ExecutionAutonomy;
  riskPolicy: { values: RiskPolicyLimits; canManage: boolean };
  credentials: Credentials;
  strategyHealth: StrategyHealth;
}) {
  const router = useRouter();

  return (
    <div className="flex flex-col gap-6">
      {marketKillSwitch && <MarketKillSwitchCard state={marketKillSwitch} onChanged={() => router.refresh()} />}
      {executionAutonomy && <ExecutionAutonomyCard state={executionAutonomy} onChanged={() => router.refresh()} />}
      <RiskPolicyCard fieldKeys={riskPolicyFieldKeys} initial={riskPolicy.values} canManage={riskPolicy.canManage} onChanged={() => router.refresh()} />
      {credentials && (
        <CredentialsCard supportedProviders={supportedProviders} state={credentials} onChanged={() => router.refresh()} />
      )}
      {strategyHealth && <StrategyHealthCard state={strategyHealth} onChanged={() => router.refresh()} />}
    </div>
  );
}

function MarketKillSwitchCard({ state, onChanged }: { state: NonNullable<MarketKillSwitch>; onChanged: () => void }) {
  const [engaged, setEngaged] = useState(state.engaged);
  const [isWorking, setIsWorking] = useState(false);
  const canToggle = engaged ? state.canDisengage : state.canEngage;

  async function handleToggle() {
    setIsWorking(true);
    const result = engaged ? await disengageMarketKillSwitchAction() : await engageMarketKillSwitchAction();
    setIsWorking(false);
    if (!result.success) {
      toast.error(result.error);
      return;
    }
    setEngaged((prev) => !prev);
    toast.success(engaged ? "Market kill switch disengaged" : "Market kill switch engaged");
    onChanged();
  }

  return (
    <Card className={engaged ? "border-destructive" : undefined}>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-base">Market kill switch</CardTitle>
            <CardDescription>
              Blocks every new live order submission immediately, regardless of any other setting on this page.
              Checked fresh on every submission — never cached. Existing open positions are never touched.
            </CardDescription>
          </div>
          <Badge variant={engaged ? "destructive" : "secondary"}>{engaged ? "Engaged" : "Off"}</Badge>
        </div>
      </CardHeader>
      {canToggle && (
        <CardFooter>
          <Button type="button" variant={engaged ? "outline" : "destructive"} disabled={isWorking} onClick={handleToggle}>
            {isWorking ? "Working…" : engaged ? "Disengage kill switch" : "Engage kill switch"}
          </Button>
        </CardFooter>
      )}
    </Card>
  );
}

function ExecutionAutonomyCard({ state, onChanged }: { state: NonNullable<ExecutionAutonomy>; onChanged: () => void }) {
  const [enabled, setEnabled] = useState(state.enabled);
  const [isWorking, setIsWorking] = useState(false);

  async function handleToggle() {
    setIsWorking(true);
    const result = await setExecutionAutonomyAction(!enabled);
    setIsWorking(false);
    if (!result.success) {
      toast.error(result.error);
      return;
    }
    setEnabled((prev) => !prev);
    toast.success(enabled ? "Autonomous execution disabled" : "Autonomous execution enabled");
    onChanged();
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-base">Autonomous execution</CardTitle>
            <CardDescription>
              Opts this organization into the scheduled autonomous-execution job. This is one of three independent
              gates a submission still must clear: the deployment-wide <code>LIVE_EXECUTION_ENABLED</code> flag (set
              by an operator, not here) and the market kill switch above both still apply and cannot be bypassed by
              this toggle.
            </CardDescription>
          </div>
          <Badge variant={enabled ? "default" : "secondary"}>{enabled ? "Enabled" : "Disabled"}</Badge>
        </div>
      </CardHeader>
      {state.canManage && (
        <CardFooter>
          <Button type="button" variant={enabled ? "outline" : "default"} disabled={isWorking} onClick={handleToggle}>
            {isWorking ? "Working…" : enabled ? "Disable" : "Enable"}
          </Button>
        </CardFooter>
      )}
    </Card>
  );
}

const FIELD_LABELS: Record<string, string> = {
  maxLeverage: "Max leverage",
  maxOrderNotionalPct: "Max order notional (% of equity)",
  maxTotalExposureMultiple: "Max total exposure (multiple of equity)",
  maxSimultaneousPositions: "Max simultaneous positions",
  maxSymbolExposurePct: "Max exposure per symbol (% of equity)",
  maxStrategyExposurePct: "Max exposure per strategy (% of equity)",
  maxDailyLossPct: "Max daily loss (% of equity)",
  maxConsecutiveLosses: "Max consecutive losses",
  maxPortfolioDrawdownPct: "Portfolio drawdown breaker (%)",
  emergencyStopThresholdPct: "Emergency stop threshold (%)",
};

function RiskPolicyCard({
  fieldKeys,
  initial,
  canManage,
  onChanged,
}: {
  fieldKeys: (keyof RiskPolicyLimits)[];
  initial: RiskPolicyLimits;
  canManage: boolean;
  onChanged: () => void;
}) {
  const [values, setValues] = useState(initial);
  const [form, setForm] = useState(initial);
  const [isSaving, setIsSaving] = useState(false);

  async function handleSave(event: React.FormEvent) {
    event.preventDefault();
    setIsSaving(true);
    const result = await updateRiskPolicyAction(form);
    setIsSaving(false);
    if (!result.success) {
      toast.error(result.error);
      return;
    }
    setValues(form);
    toast.success("Risk policy updated");
    onChanged();
  }

  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <CardTitle className="text-base">Risk policy</CardTitle>
        <CardDescription>
          Every field is clamped to a hardcoded absolute ceiling no configured value can ever exceed — a change here
          can only ever tighten limits toward that ceiling, never loosen execution beyond it.
        </CardDescription>
      </CardHeader>
      <form onSubmit={handleSave}>
        <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {fieldKeys.map((key) => (
            <div key={key} className="flex flex-col gap-2">
              <Label htmlFor={`risk-${key}`}>{FIELD_LABELS[key] ?? key}</Label>
              <Input
                id={`risk-${key}`}
                type="number"
                min={0}
                step="0.01"
                disabled={!canManage}
                value={form[key]}
                onChange={(e) => setForm((prev) => ({ ...prev, [key]: Number(e.target.value) }))}
              />
            </div>
          ))}
        </CardContent>
        {canManage && (
          <CardFooter>
            <Button type="submit" disabled={isSaving || JSON.stringify(form) === JSON.stringify(values)}>
              {isSaving ? "Saving…" : "Save risk policy"}
            </Button>
          </CardFooter>
        )}
      </form>
    </Card>
  );
}

function CredentialsCard({
  supportedProviders,
  state,
  onChanged,
}: {
  supportedProviders: string[];
  state: NonNullable<Credentials>;
  onChanged: () => void;
}) {
  const [statuses, setStatuses] = useState(state.statuses);
  const [provider, setProvider] = useState(supportedProviders[0] ?? "");
  const [apiKey, setApiKey] = useState("");
  const [apiSecret, setApiSecret] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [revokingProvider, setRevokingProvider] = useState<string | null>(null);

  async function handleSave(event: React.FormEvent) {
    event.preventDefault();
    setIsSaving(true);
    const result = await configureCredentialsAction({ provider, apiKey, apiSecret });
    setIsSaving(false);
    if (!result.success) {
      toast.error(result.error);
      return;
    }
    setApiKey("");
    setApiSecret("");
    toast.success(`Credentials saved for ${provider}`);
    onChanged();
  }

  async function handleRevoke(providerToRevoke: string) {
    setRevokingProvider(providerToRevoke);
    const result = await revokeCredentialsAction(providerToRevoke);
    setRevokingProvider(null);
    if (!result.success) {
      toast.error(result.error);
      return;
    }
    setStatuses((prev) => prev.map((s) => (s.provider === providerToRevoke ? { ...s, configured: false, revokedAt: new Date() } : s)));
    toast.success(`Credentials revoked for ${providerToRevoke}`);
    onChanged();
  }

  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <CardTitle className="text-base">Exchange credentials</CardTitle>
        <CardDescription>
          Encrypted at rest; only a fingerprint is ever shown here, never the key or secret. Only {supportedProviders.join(", ")}{" "}
          has a real, working execution adapter — no other provider can be configured.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {statuses.length > 0 && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Provider</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Fingerprint</TableHead>
                <TableHead>Rotated</TableHead>
                {state.canRevoke && <TableHead />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {statuses.map((s) => (
                <TableRow key={s.provider}>
                  <TableCell className="font-medium">{s.provider}</TableCell>
                  <TableCell>
                    <Badge variant={s.configured ? "default" : "secondary"}>{s.configured ? "Configured" : "Not configured"}</Badge>
                  </TableCell>
                  <TableCell className="font-mono text-xs">{s.fingerprint ?? "—"}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{s.rotatedAt ? new Date(s.rotatedAt).toLocaleString() : "—"}</TableCell>
                  {state.canRevoke && (
                    <TableCell>
                      {s.configured && (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={revokingProvider === s.provider}
                          onClick={() => handleRevoke(s.provider)}
                        >
                          {revokingProvider === s.provider ? "Revoking…" : "Revoke"}
                        </Button>
                      )}
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        {state.canManage && (
          <form onSubmit={handleSave} className="flex flex-col gap-4 border-t pt-4">
            <p className="text-sm font-medium">Configure or rotate</p>
            <div className="flex flex-col gap-2">
              <Label>Provider</Label>
              <Select value={provider} onValueChange={setProvider}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {supportedProviders.map((p) => (
                    <SelectItem key={p} value={p}>
                      {p}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="cred-api-key">API key</Label>
              <Input id="cred-api-key" type="password" autoComplete="off" value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="cred-api-secret">API secret</Label>
              <Input id="cred-api-secret" type="password" autoComplete="off" value={apiSecret} onChange={(e) => setApiSecret(e.target.value)} />
            </div>
            <Button type="submit" disabled={isSaving || !apiKey.trim() || !apiSecret.trim()} className="w-fit">
              {isSaving ? "Saving…" : "Save credentials"}
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}

const STRATEGY_HEALTH_BADGE: Record<string, "default" | "secondary" | "destructive"> = {
  TRIAL: "secondary",
  ACTIVE: "default",
  QUARANTINED: "destructive",
  RETIRED: "destructive",
};

function StrategyHealthCard({ state, onChanged }: { state: NonNullable<StrategyHealth>; onChanged: () => void }) {
  const [rows, setRows] = useState(state.rows);
  const [reactivatingType, setReactivatingType] = useState<string | null>(null);

  async function handleReactivate(strategyType: string) {
    setReactivatingType(strategyType);
    const result = await reactivateStrategyAction(strategyType);
    setReactivatingType(null);
    if (!result.success) {
      toast.error(result.error);
      return;
    }
    setRows((prev) => prev.map((r) => (r.strategyType === strategyType ? { ...r, status: "ACTIVE", reason: "manually reactivated" } : r)));
    toast.success(`${strategyType} reactivated`);
    onChanged();
  }

  if (rows.length === 0) {
    return null;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Strategy health</CardTitle>
        <CardDescription>
          Automatic quarantine/retirement is one-way — a strategy can only be brought back to ACTIVE by a human here,
          never automatically.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Strategy</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Score</TableHead>
              <TableHead>Reason</TableHead>
              {state.canManage && <TableHead />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.strategyType}>
                <TableCell className="font-medium">{r.strategyType}</TableCell>
                <TableCell>
                  <Badge variant={STRATEGY_HEALTH_BADGE[r.status] ?? "secondary"}>{r.status}</Badge>
                </TableCell>
                <TableCell>{r.evaluationScoreAtLastCheck ?? "—"}</TableCell>
                <TableCell className="max-w-md truncate text-xs text-muted-foreground" title={r.reason ?? undefined}>
                  {r.reason ?? "—"}
                </TableCell>
                {state.canManage && (
                  <TableCell>
                    {(r.status === "QUARANTINED" || r.status === "RETIRED") && (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={reactivatingType === r.strategyType}
                        onClick={() => handleReactivate(r.strategyType)}
                      >
                        {reactivatingType === r.strategyType ? "Working…" : "Reactivate"}
                      </Button>
                    )}
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
