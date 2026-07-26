import { z } from "zod";

import {
  channelSchema,
  conversationPurposeSchema,
  ingestionModeSchema,
} from "@/lib/conversations/types";

export const ingestionEventTypeSchema = z.enum([
  "conversation.opened",
  "participant.upserted",
  "message.upserted",
  "message.deleted",
  "attachment.registered",
  "conversation.closed",
]);
export type IngestionEventType = z.infer<typeof ingestionEventTypeSchema>;

export const ingestionEventSchema = z.object({
  schemaVersion: z.literal(1),
  eventId: z.string().min(1),
  adapterId: z.string().min(1),
  adapterVersion: z.string().min(1),
  idempotencyKey: z.string().min(1),
  externalConversationKey: z.string().min(1).optional(),
  occurredAt: z.string().datetime().optional(),
  receivedAt: z.string().datetime(),
  sequence: z.number().int().nonnegative().optional(),
  type: ingestionEventTypeSchema,
  payload: z.record(z.unknown()),
  rawArtifactRef: z.string().min(1).optional(),
});
export type IngestionEvent = z.infer<typeof ingestionEventSchema>;

export const adapterIssueSchema = z.object({
  code: z.enum([
    "unsupported_format",
    "invalid_input",
    "ambiguous_sender",
    "ambiguous_timestamp",
    "duplicate",
    "out_of_order",
    "attachment_unavailable",
    "truncated",
    "unsafe_content",
  ]),
  severity: z.enum(["warning", "error"]),
  message: z.string().min(1),
  location: z.string().optional(),
  recoverable: z.boolean(),
  metadata: z.record(z.unknown()).default({}),
});
export type AdapterIssue = z.infer<typeof adapterIssueSchema>;

export interface AdapterCapabilities {
  channels: z.infer<typeof channelSchema>[];
  ingestionModes: z.infer<typeof ingestionModeSchema>[];
  supportsAttachments: boolean;
  supportsEdits: boolean;
  supportsDeletes: boolean;
  supportsIncremental: boolean;
}

export interface AdapterContext {
  organizationId: string;
  purpose: z.infer<typeof conversationPurposeSchema>;
  channelHint?: z.infer<typeof channelSchema>;
  customerLanguage?: string;
  receivedAt: string;
  rawArtifactRef?: string;
  /** Explicit user-confirmed sender mappings override parser guesses. */
  participantRoleOverrides?: Record<string, string>;
}

export type AdapterOutput =
  | { event: IngestionEvent; issue?: never }
  | { event?: never; issue: AdapterIssue };

/**
 * Adapters parse only. They never call a model, run compliance checks, persist
 * data, or send replies. This keeps replay deterministic and testable.
 */
export interface ChannelAdapter<Input> {
  readonly id: string;
  readonly version: string;
  readonly capabilities: AdapterCapabilities;
  accepts(input: unknown): input is Input;
  normalize(input: Input, context: AdapterContext): AsyncIterable<AdapterOutput>;
}

export const ingestionRunSchema = z.object({
  id: z.string().min(1),
  organizationId: z.string().min(1),
  adapterId: z.string().min(1),
  adapterVersion: z.string().min(1),
  channel: channelSchema,
  ingestionMode: ingestionModeSchema,
  purpose: conversationPurposeSchema,
  status: z.enum(["received", "validating", "processing", "completed", "partial", "failed"]),
  rawArtifactPath: z.string().optional(),
  rawContentHash: z.string().min(1),
  eventCount: z.number().int().nonnegative().default(0),
  issueCount: z.number().int().nonnegative().default(0),
  createdAt: z.string().datetime(),
  completedAt: z.string().datetime().optional(),
});
export type IngestionRun = z.infer<typeof ingestionRunSchema>;
