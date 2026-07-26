import { z } from "zod";

/**
 * Channel, ingestion method, and purpose are intentionally orthogonal.
 * Example: a pasted WhatsApp export is channel=whatsapp,
 * ingestionMode=export, purpose=sales.
 */
export const channelSchema = z.enum([
  "live_voice",
  "email",
  "whatsapp",
  "sms",
  "web_chat",
  "ticket",
  "in_person",
  "transcript",
  "unknown",
]);
export type Channel = z.infer<typeof channelSchema>;

export const ingestionModeSchema = z.enum([
  "live",
  "paste",
  "upload",
  "export",
  "api",
]);
export type IngestionMode = z.infer<typeof ingestionModeSchema>;

export const conversationPurposeSchema = z.enum(["sales", "support", "mixed"]);
export type ConversationPurpose = z.infer<typeof conversationPurposeSchema>;

export const conversationLifecycleSchema = z.enum(["open", "closed", "reopened"]);
export const processingStateSchema = z.enum([
  "idle",
  "queued",
  "processing",
  "ready",
  "needs_review",
  "error",
]);

export const conversationSchema = z.object({
  id: z.string().min(1),
  organizationId: z.string().min(1),
  channel: channelSchema,
  ingestionMode: ingestionModeSchema,
  purpose: conversationPurposeSchema,
  lifecycle: conversationLifecycleSchema.default("open"),
  processingState: processingStateSchema.default("idle"),
  productId: z.string().min(1).optional(),
  policyPackIds: z.array(z.string().min(1)).default([]),
  externalThreadKey: z.string().min(1).optional(),
  customerLanguage: z.string().min(1).optional(),
  title: z.string().min(1).optional(),
  startedAt: z.string().datetime().optional(),
  lastActivityAt: z.string().datetime(),
  closedAt: z.string().datetime().optional(),
  revision: z.number().int().nonnegative().default(0),
  metadata: z.record(z.unknown()).default({}),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Conversation = z.infer<typeof conversationSchema>;

export const participantRoleSchema = z.enum([
  "agent",
  "customer",
  "supervisor",
  "system",
  "bot",
  "third_party",
  "unknown",
]);
export type ParticipantRole = z.infer<typeof participantRoleSchema>;

export const participantSchema = z.object({
  id: z.string().min(1),
  conversationId: z.string().min(1),
  role: participantRoleSchema,
  displayName: z.string().min(1).optional(),
  externalId: z.string().min(1).optional(),
  roleConfidence: z.number().min(0).max(1).default(0),
  metadata: z.record(z.unknown()).default({}),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Participant = z.infer<typeof participantSchema>;

export const messageDirectionSchema = z.enum([
  "outbound",
  "inbound",
  "internal",
  "unknown",
]);
export const messageVisibilitySchema = z.enum(["customer_visible", "internal"]);
export const messageStateSchema = z.enum([
  "draft",
  "sent",
  "received",
  "edited",
  "deleted",
]);
export const messageModalitySchema = z.enum([
  "text",
  "speech",
  "document",
  "image",
  "audio",
  "system",
]);

export const messageSchema = z.object({
  id: z.string().min(1),
  conversationId: z.string().min(1),
  participantId: z.string().min(1).optional(),
  externalMessageId: z.string().min(1).optional(),
  revision: z.number().int().nonnegative().default(0),
  direction: messageDirectionSchema,
  visibility: messageVisibilitySchema.default("customer_visible"),
  state: messageStateSchema,
  modality: messageModalitySchema,
  originalText: z.string().default(""),
  normalizedText: z.string().default(""),
  language: z.string().min(1).optional(),
  occurredAt: z.string().datetime().optional(),
  receivedAt: z.string().datetime(),
  ordinal: z.number().int().nonnegative(),
  replyToMessageId: z.string().min(1).optional(),
  confidence: z.number().min(0).max(1).optional(),
  sourceHash: z.string().min(1),
  metadata: z.record(z.unknown()).default({}),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Message = z.infer<typeof messageSchema>;

export const attachmentSchema = z.object({
  id: z.string().min(1),
  conversationId: z.string().min(1),
  messageId: z.string().min(1).optional(),
  fileName: z.string().min(1),
  mediaType: z.string().min(1),
  byteSize: z.number().int().nonnegative(),
  contentHash: z.string().min(1),
  storagePath: z.string().min(1),
  extractionState: z.enum(["pending", "processing", "ready", "failed"]).default("pending"),
  extractedText: z.string().optional(),
  metadata: z.record(z.unknown()).default({}),
  createdAt: z.string().datetime(),
});
export type Attachment = z.infer<typeof attachmentSchema>;

/** Only these messages may create agent findings or satisfy obligations. */
export function isAuditableAgentMessage(
  message: Message,
  participant: Participant | undefined,
): boolean {
  return (
    participant?.role === "agent" &&
    participant.roleConfidence >= 0.8 &&
    message.direction === "outbound" &&
    message.visibility === "customer_visible" &&
    (message.state === "sent" || message.state === "received")
  );
}
