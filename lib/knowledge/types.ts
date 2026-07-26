import { z } from "zod";

import { conversationPurposeSchema } from "@/lib/conversations/types";

export const referenceDocumentSchema = z.object({
  id: z.string().min(1),
  organizationId: z.string().min(1),
  productId: z.string().min(1).optional(),
  title: z.string().min(1),
  documentType: z.enum([
    "product_terms",
    "regulation",
    "support_playbook",
    "process",
    "faq",
    "other",
  ]),
  status: z.enum(["draft", "active", "retired"]).default("draft"),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type ReferenceDocument = z.infer<typeof referenceDocumentSchema>;

export const documentVersionSchema = z.object({
  id: z.string().min(1),
  documentId: z.string().min(1),
  version: z.number().int().positive(),
  contentHash: z.string().min(1),
  storagePath: z.string().min(1),
  mediaType: z.string().min(1),
  effectiveFrom: z.string().datetime().optional(),
  effectiveTo: z.string().datetime().optional(),
  extractionState: z.enum(["pending", "processing", "ready", "failed"]),
  extractionError: z.string().optional(),
  reviewedAt: z.string().datetime().optional(),
  reviewedBy: z.string().min(1).optional(),
  createdAt: z.string().datetime(),
});
export type DocumentVersion = z.infer<typeof documentVersionSchema>;

export const documentChunkSchema = z.object({
  id: z.string().min(1),
  documentVersionId: z.string().min(1),
  ordinal: z.number().int().nonnegative(),
  pageNumber: z.number().int().positive().optional(),
  sectionPath: z.array(z.string()).default([]),
  text: z.string().min(1),
  startOffset: z.number().int().nonnegative().optional(),
  endOffset: z.number().int().nonnegative().optional(),
  contentHash: z.string().min(1),
  metadata: z.record(z.unknown()).default({}),
});
export type DocumentChunk = z.infer<typeof documentChunkSchema>;

export const complianceFactSchema = z.object({
  id: z.string().min(1),
  documentVersionId: z.string().min(1),
  factKey: z.string().min(1),
  value: z.unknown(),
  evidenceChunkIds: z.array(z.string().min(1)).min(1),
  confidence: z.number().min(0).max(1),
  reviewStatus: z.enum(["unreviewed", "approved", "rejected"]).default("unreviewed"),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type ComplianceFact = z.infer<typeof complianceFactSchema>;

export const checkDefinitionSchema = z.object({
  id: z.string().min(1),
  kind: z.enum([
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
  ]),
  title: z.string().min(1),
  description: z.string().min(1),
  scope: z.enum(["message", "conversation"]),
  severity: z.enum(["info", "low", "medium", "high", "critical"]),
  evaluator: z.enum(["rule", "model", "hybrid"]),
  config: z.record(z.unknown()).default({}),
  requiredEvidenceFactKeys: z.array(z.string()).default([]),
  enabled: z.boolean().default(true),
});
export type CheckDefinition = z.infer<typeof checkDefinitionSchema>;

export const policyPackSchema = z.object({
  id: z.string().min(1),
  organizationId: z.string().min(1),
  name: z.string().min(1),
  domain: z.string().min(1),
  purpose: conversationPurposeSchema,
  version: z.number().int().positive(),
  status: z.enum(["draft", "active", "retired"]),
  checkDefinitions: z.array(checkDefinitionSchema),
  effectiveFrom: z.string().datetime().optional(),
  effectiveTo: z.string().datetime().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type PolicyPack = z.infer<typeof policyPackSchema>;
