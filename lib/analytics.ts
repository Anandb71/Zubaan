import "server-only";

import { languageLabel } from "@/lib/i18n/languages";
import { store } from "@/lib/store";

export interface AgentMetric {
  id: string;
  name: string;
  branch: string;
  calls: number;
  violatingCalls: number;
  violations: number;
  violationRate: number;
}

export interface GroupMetric {
  key: string;
  label: string;
  count: number;
  share: number;
}

export interface ComplianceSnapshot {
  generatedAt: string;
  totalCalls: number;
  totalViolations: number;
  contradictionCount: number;
  omissionCount: number;
  callsWithViolations: number;
  overallViolationRate: number;
  agents: AgentMetric[];
  languages: GroupMetric[];
  falsePromises: GroupMetric[];
  skippedDisclosures: GroupMetric[];
}

export async function getComplianceSnapshot(): Promise<ComplianceSnapshot> {
  const [agents, calls, violations] = await Promise.all([
    store.listAgents(),
    store.listCalls(),
    store.listViolations(),
  ]);

  const violationsByCall = new Map<string, number>();
  for (const violation of violations) {
    violationsByCall.set(violation.callId, (violationsByCall.get(violation.callId) ?? 0) + 1);
  }

  const agentMetrics = agents
    .map((agent): AgentMetric => {
      const owned = calls.filter((call) => call.agentId === agent.id);
      const ownedIds = new Set(owned.map((call) => call.id));
      const ownedViolations = violations.filter((violation) => ownedIds.has(violation.callId));
      const violatingCalls = owned.filter((call) => violationsByCall.has(call.id)).length;
      return {
        ...agent,
        calls: owned.length,
        violatingCalls,
        violations: ownedViolations.length,
        violationRate: owned.length ? round((violatingCalls / owned.length) * 100) : 0,
      };
    })
    .sort((a, b) => b.violationRate - a.violationRate || b.violations - a.violations);

  const contradictions = violations.filter((violation) => violation.kind === "contradiction");
  const omissions = violations.filter((violation) => violation.kind === "omission");
  const violatingCallCount = violationsByCall.size;

  return {
    generatedAt: new Date().toISOString(),
    totalCalls: calls.length,
    totalViolations: violations.length,
    contradictionCount: contradictions.length,
    omissionCount: omissions.length,
    callsWithViolations: violatingCallCount,
    overallViolationRate: calls.length ? round((violatingCallCount / calls.length) * 100) : 0,
    agents: agentMetrics,
    languages: group(
      violations,
      (violation) => violation.detectedLang ?? "unknown",
      (key) => languageLabel(key),
    ),
    falsePromises: group(
      contradictions,
      (violation) => normalizePromise(violation.claimMade ?? violation.utterance),
      titleCase,
    ),
    skippedDisclosures: group(
      omissions,
      (violation) => violation.disclosureId ?? "other_required_disclosure",
      (key) => titleCase(key.replace(/_/g, " ")),
    ),
  };
}

function group<T>(
  values: T[],
  keyOf: (value: T) => string,
  labelOf: (key: string) => string,
): GroupMetric[] {
  const counts = new Map<string, number>();
  for (const value of values) {
    const key = keyOf(value);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const total = values.length;
  return [...counts.entries()]
    .map(([key, count]) => ({
      key,
      label: labelOf(key),
      count,
      share: total ? round((count / total) * 100) : 0,
    }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

function normalizePromise(input: string): string {
  const text = input.toLowerCase();
  if (/guarante|12%|12 percent|pakka/.test(text)) return "guaranteed_returns";
  if (/withdraw|anytime|kabhi/.test(text)) return "withdraw_anytime";
  if (/charge|fee/.test(text)) return "no_charges";
  if (/risk/.test(text)) return "risk_free";
  return input.slice(0, 64) || "other_false_promise";
}

function titleCase(input: string): string {
  return input
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}
