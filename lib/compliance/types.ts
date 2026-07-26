import { z } from "zod";

export const findingKindSchema = z.enum([
  "contradiction",
  "omission",
  "unsupported_guidance",
  "prohibited_commitment",
  "verification",
  "privacy",
  "process",
  "escalation",
  "sla",
  "resolution",
  "coaching",
]);
export type FindingKind = z.infer<typeof findingKindSchema>;

export const findingOutcomeSchema = z.enum([
  "fail",
  "pass",
  "needs_evidence",
  "needs_review",
  "not_applicable",
]);
export const findingLifecycleSchema = z.enum([
  "open",
  "corrected",
  "confirmed",
  "dismissed",
  "superseded",
]);
export const findingSeveritySchema = z.enum([
  "info",
  "low",
  "medium",
  "high",
  "critical",
]);

export const evidenceRefSchema = z.object({
  id: z.string().min(1),
  findingId: z.string().min(1),
  evidenceType: z.enum([
    "trigger_message",
    "satisfaction_message",
    "document_chunk",
    "compliance_fact",
    "policy_rule",
    "system_record",
    "legacy_quote",
  ]),
  messageId: z.string().min(1).optional(),
  documentChunkId: z.string().min(1).optional(),
  complianceFactId: z.string().min(1).optional(),
  startOffset: z.number().int().nonnegative().optional(),
  endOffset: z.number().int().nonnegative().optional(),
  quote: z.string().min(1),
  metadata: z.record(z.unknown()).default({}),
  createdAt: z.string().datetime(),
});
export type EvidenceRef = z.infer<typeof evidenceRefSchema>;

export const findingSchema = z.object({
  id: z.string().min(1),
  organizationId: z.string().min(1),
  conversationId: z.string().min(1),
  auditRunId: z.string().min(1),
  checkDefinitionId: z.string().min(1),
  fingerprint: z.string().min(1),
  kind: findingKindSchema,
  outcome: findingOutcomeSchema,
  lifecycle: findingLifecycleSchema.default("open"),
  severity: findingSeveritySchema,
  title: z.string().min(1),
  explanation: z.string().min(1),
  coachSuggestion: z.string().optional(),
  implicatedMessageIds: z.array(z.string().min(1)).default([]),
  confidence: z.number().min(0).max(1),
  source: z.enum(["rule", "model", "hybrid", "human"]),
  provider: z.string().optional(),
  model: z.string().optional(),
  promptVersion: z.string().optional(),
  latencyMs: z.number().int().nonnegative().optional(),
  reviewedAt: z.string().datetime().optional(),
  reviewedBy: z.string().min(1).optional(),
  reviewNote: z.string().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Finding = z.infer<typeof findingSchema>;

export const obligationStateSchema = z.object({
  id: z.string().min(1),
  organizationId: z.string().min(1),
  conversationId: z.string().min(1),
  conversationRevision: z.number().int().nonnegative(),
  checkDefinitionId: z.string().min(1),
  status: z.enum([
    "pending",
    "satisfied",
    "missing",
    "not_applicable",
    "needs_review",
  ]),
  satisfactionMessageIds: z.array(z.string().min(1)).default([]),
  confidence: z.number().min(0).max(1),
  derivedAt: z.string().datetime(),
});
export type ObligationState = z.infer<typeof obligationStateSchema>;

export const auditRunSchema = z.object({
  id: z.string().min(1),
  organizationId: z.string().min(1),
  conversationId: z.string().min(1),
  conversationRevision: z.number().int().nonnegative(),
  policyPackId: z.string().min(1),
  policyPackVersion: z.number().int().positive(),
  knowledgeSnapshot: z.record(z.number().int().positive()),
  trigger: z.enum([
    "live_window",
    "message_changed",
    "conversation_finalized",
    "manual_review",
    "migration",
  ]),
  status: z.enum(["queued", "running", "completed", "degraded", "failed"]),
  startedAt: z.string().datetime(),
  completedAt: z.string().datetime().optional(),
  degradedReasons: z.array(z.string()).default([]),
  metrics: z.record(z.number()).default({}),
  createdAt: z.string().datetime(),
});
export type AuditRun = z.infer<typeof auditRunSchema>;

export const auditArtifactSchema = z.object({
  id: z.string().min(1),
  organizationId: z.string().min(1),
  conversationId: z.string().min(1),
  auditRunId: z.string().min(1),
  audience: z.enum(["agent", "compliance", "customer"]),
  language: z.string().min(1),
  summary: z.string(),
  promised: z.array(z.string()).default([]),
  actual: z.array(z.string()).default([]),
  gaps: z.array(z.string()).default([]),
  audioStoragePath: z.string().optional(),
  createdAt: z.string().datetime(),
});
export type AuditArtifact = z.infer<typeof auditArtifactSchema>;
