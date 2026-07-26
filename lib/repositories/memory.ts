import { createHash } from "node:crypto";

import type { output, ZodTypeAny } from "zod";

import {
  auditArtifactSchema,
  auditRunSchema,
  evidenceRefSchema,
  findingSchema,
  obligationStateSchema,
  type AuditArtifact,
  type AuditRun,
  type EvidenceRef,
  type Finding,
  type ObligationState,
} from "@/lib/compliance/types";
import {
  attachmentSchema,
  conversationSchema,
  messageSchema,
  participantSchema,
  type Attachment,
  type Conversation,
  type Message,
  type Participant,
} from "@/lib/conversations/types";
import {
  ingestionEventSchema,
  ingestionRunSchema,
  type IngestionEvent,
  type IngestionRun,
} from "@/lib/ingestion/types";
import { err, Errors, ok, type Result } from "@/lib/kernel";
import type {
  ClaimEventResult,
  ComplianceRepository,
  ConversationQuery,
  ConversationRepository,
  IngestionRepository,
  OrganizationScope,
  PrivateBucket,
  PrivateObjectRepository,
  PutMessageInput,
  PutMessageResult,
  PutPrivateObjectInput,
  RepositoryBundle,
  StoredObject,
  WriteResult,
} from "@/lib/repositories/contracts";

interface EventRecord {
  organizationId: string;
  ingestionRunId: string;
  event: IngestionEvent;
  processedAt?: string;
  processingError?: string;
}

interface ObjectRecord {
  object: StoredObject;
  bytes: Uint8Array;
}

interface MemoryState {
  conversations: Map<string, Conversation>;
  participants: Map<string, Participant>;
  messages: Map<string, Message>;
  messageRevisions: Map<string, Message>;
  attachments: Map<string, Attachment>;
  ingestionRuns: Map<string, IngestionRun>;
  ingestionEvents: Map<string, EventRecord>;
  eventIdempotency: Map<string, string>;
  auditRuns: Map<string, AuditRun>;
  findings: Map<string, Finding>;
  evidence: Map<string, EvidenceRef>;
  obligations: Map<string, ObligationState>;
  artifacts: Map<string, AuditArtifact>;
  objects: Map<string, ObjectRecord>;
}

function createState(): MemoryState {
  return {
    conversations: new Map(),
    participants: new Map(),
    messages: new Map(),
    messageRevisions: new Map(),
    attachments: new Map(),
    ingestionRuns: new Map(),
    ingestionEvents: new Map(),
    eventIdempotency: new Map(),
    auditRuns: new Map(),
    findings: new Map(),
    evidence: new Map(),
    obligations: new Map(),
    artifacts: new Map(),
    objects: new Map(),
  };
}

class KeyedSerialExecutor {
  private readonly tails = new Map<string, Promise<void>>();

  async run<T>(key: string, task: () => Promise<T> | T): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    let release = () => {};
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.then(() => current);
    this.tails.set(key, tail);
    await previous;

    try {
      return await task();
    } finally {
      release();
      if (this.tails.get(key) === tail) this.tails.delete(key);
    }
  }
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function same(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function validate<S extends ZodTypeAny>(
  schema: S,
  value: unknown,
  label: string,
): Result<output<S>> {
  const parsed = schema.safeParse(value);
  if (parsed.success) return ok(parsed.data as output<S>);
  return err(
    Errors.validation(`Invalid ${label}`, {
      context: { issues: parsed.error.issues },
    }),
  );
}

function conflict(message: string, context: Record<string, unknown> = {}) {
  return err(Errors.conflict(message, { context }));
}

function assertOrganization(
  scope: OrganizationScope,
  entityOrganizationId: string,
  entity: string,
): Result<void> {
  if (scope.organizationId === entityOrganizationId) return ok(undefined);
  return err(
    Errors.forbidden(`${entity} does not belong to this organization`, {
      context: { organizationId: scope.organizationId },
    }),
  );
}

function assertSafeSegment(value: string, label: string): Result<string> {
  if (/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(value) && value !== "..") {
    return ok(value);
  }
  return err(Errors.validation(`${label} contains unsafe path characters`));
}

function safeFileName(value: string): string {
  const leaf = value.replaceAll("\\", "/").split("/").at(-1) ?? "file";
  const normalized = leaf.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^\.+/, "");
  return normalized.slice(0, 160) || "file";
}

function objectKey(bucket: PrivateBucket, path: string): string {
  return `${bucket}:${path}`;
}

function scopedPath(scope: OrganizationScope, path: string): Result<string> {
  const safeOrganization = assertSafeSegment(scope.organizationId, "organizationId");
  if (!safeOrganization.ok) return safeOrganization;
  if (!path.startsWith(`${safeOrganization.value}/`)) {
    return err(Errors.forbidden("Object path is outside this organization"));
  }
  return ok(path);
}

export class MemoryRepositories
  implements
    RepositoryBundle,
    ConversationRepository,
    IngestionRepository,
    ComplianceRepository,
    PrivateObjectRepository
{
  readonly conversations: ConversationRepository = this;
  readonly ingestion: IngestionRepository = this;
  readonly compliance: ComplianceRepository = this;
  readonly objects: PrivateObjectRepository = this;

  private readonly state: MemoryState;
  private readonly serial = new KeyedSerialExecutor();

  constructor(state: MemoryState = createState()) {
    this.state = state;
  }

  async createConversation(
    scope: OrganizationScope,
    input: Conversation,
  ): Promise<Result<WriteResult<Conversation>>> {
    const parsed = validate(conversationSchema, input, "conversation");
    if (!parsed.ok) return parsed;
    const owned = assertOrganization(scope, parsed.value.organizationId, "Conversation");
    if (!owned.ok) return owned;

    return this.serial.run(`conversation:${input.id}`, () => {
      const existing = this.state.conversations.get(input.id);
      if (existing) {
        if (existing.organizationId !== scope.organizationId) {
          return conflict("Conversation id is already in use");
        }
        if (!same(existing, parsed.value)) {
          return conflict("Conversation idempotency conflict", { conversationId: input.id });
        }
        return ok({ disposition: "duplicate" as const, value: clone(existing) });
      }

      this.state.conversations.set(parsed.value.id, clone(parsed.value));
      return ok({ disposition: "created" as const, value: clone(parsed.value) });
    });
  }

  async getConversation(
    scope: OrganizationScope,
    id: string,
  ): Promise<Result<Conversation | null>> {
    const value = this.state.conversations.get(id);
    if (!value || value.organizationId !== scope.organizationId) return ok(null);
    return ok(clone(value));
  }

  async listConversations(query: ConversationQuery): Promise<Result<Conversation[]>> {
    const limit = Math.min(Math.max(query.limit ?? 50, 1), 200);
    const rows = [...this.state.conversations.values()]
      .filter(
        (item) =>
          item.organizationId === query.organizationId &&
          (!query.purpose || item.purpose === query.purpose) &&
          (!query.channel || item.channel === query.channel) &&
          (!query.processingState || item.processingState === query.processingState) &&
          (!query.before || item.lastActivityAt < query.before),
      )
      .sort((left, right) => right.lastActivityAt.localeCompare(left.lastActivityAt))
      .slice(0, limit)
      .map(clone);
    return ok(rows);
  }

  async upsertParticipant(
    scope: OrganizationScope,
    input: Participant,
  ): Promise<Result<WriteResult<Participant>>> {
    const parsed = validate(participantSchema, input, "participant");
    if (!parsed.ok) return parsed;
    const conversation = this.state.conversations.get(parsed.value.conversationId);
    if (!conversation || conversation.organizationId !== scope.organizationId) {
      return err(Errors.notFound("Conversation not found"));
    }

    return this.serial.run(`participant:${input.id}`, () => {
      const existing = this.state.participants.get(input.id);
      if (existing) {
        const existingConversation = this.state.conversations.get(existing.conversationId);
        if (existingConversation?.organizationId !== scope.organizationId) {
          return conflict("Participant id is already in use");
        }
        if (same(existing, parsed.value)) {
          return ok({ disposition: "duplicate" as const, value: clone(existing) });
        }
        if (existing.conversationId !== parsed.value.conversationId) {
          return conflict("Participant cannot move between conversations");
        }
        this.state.participants.set(input.id, clone(parsed.value));
        return ok({ disposition: "updated" as const, value: clone(parsed.value) });
      }

      if (parsed.value.externalId) {
        const duplicate = [...this.state.participants.values()].find(
          (item) =>
            item.conversationId === parsed.value.conversationId &&
            item.externalId === parsed.value.externalId,
        );
        if (duplicate) {
          if (same(duplicate, parsed.value)) {
            return ok({ disposition: "duplicate" as const, value: clone(duplicate) });
          }
          return conflict("Participant external id is already in use");
        }
      }

      this.state.participants.set(input.id, clone(parsed.value));
      return ok({ disposition: "created" as const, value: clone(parsed.value) });
    });
  }

  async listParticipants(
    scope: OrganizationScope,
    conversationId: string,
  ): Promise<Result<Participant[]>> {
    const conversation = this.state.conversations.get(conversationId);
    if (!conversation || conversation.organizationId !== scope.organizationId) {
      return ok([]);
    }
    return ok(
      [...this.state.participants.values()]
        .filter((item) => item.conversationId === conversationId)
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
        .map(clone),
    );
  }

  async putMessage(input: PutMessageInput): Promise<Result<PutMessageResult>> {
    const parsed = validate(messageSchema, input.message, "message");
    if (!parsed.ok) return parsed;

    return this.serial.run(`conversation:${input.message.conversationId}`, () => {
      const message = parsed.value;
      const conversation = this.state.conversations.get(message.conversationId);
      if (!conversation || conversation.organizationId !== input.organizationId) {
        return err(Errors.notFound("Conversation not found"));
      }

      const existing = this.state.messages.get(message.id);
      if (existing && same(existing, message)) {
        return ok({
          disposition: "duplicate" as const,
          value: clone(existing),
          conversationRevision: conversation.revision,
        });
      }

      if (message.externalMessageId) {
        const externalDuplicate = [...this.state.messages.values()].find(
          (item) =>
            item.conversationId === message.conversationId &&
            item.externalMessageId === message.externalMessageId,
        );
        if (externalDuplicate && externalDuplicate.id !== message.id) {
          if (
            externalDuplicate.revision === message.revision &&
            externalDuplicate.sourceHash === message.sourceHash
          ) {
            return ok({
              disposition: "duplicate" as const,
              value: clone(externalDuplicate),
              conversationRevision: conversation.revision,
            });
          }
          return conflict("External message id has different content");
        }
      }

      if (conversation.revision !== input.expectedConversationRevision) {
        return conflict("Conversation revision changed", {
          expectedRevision: input.expectedConversationRevision,
          actualRevision: conversation.revision,
        });
      }

      if (message.participantId) {
        const participant = this.state.participants.get(message.participantId);
        if (!participant || participant.conversationId !== message.conversationId) {
          return err(Errors.validation("Message participant is not in this conversation"));
        }
      }

      let disposition: PutMessageResult["disposition"] = "created";
      if (existing) {
        if (existing.conversationId !== message.conversationId) {
          return conflict("Message cannot move between conversations");
        }
        if (message.revision !== existing.revision + 1) {
          return conflict("Message revision must increase by exactly one", {
            currentRevision: existing.revision,
            attemptedRevision: message.revision,
          });
        }
        if (message.ordinal !== existing.ordinal) {
          return conflict("Message ordinal is immutable");
        }
        this.state.messageRevisions.set(
          `${existing.id}:${existing.revision}`,
          clone(existing),
        );
        disposition = "updated";
      } else {
        const ordinalCollision = [...this.state.messages.values()].some(
          (item) =>
            item.conversationId === message.conversationId &&
            item.ordinal === message.ordinal,
        );
        if (ordinalCollision) {
          return conflict("Message ordinal is already in use", {
            ordinal: message.ordinal,
          });
        }
      }

      this.state.messages.set(message.id, clone(message));
      const updatedConversation: Conversation = {
        ...conversation,
        revision: conversation.revision + 1,
        lastActivityAt:
          message.occurredAt && message.occurredAt > conversation.lastActivityAt
            ? message.occurredAt
            : conversation.lastActivityAt,
        updatedAt: message.receivedAt,
      };
      this.state.conversations.set(conversation.id, updatedConversation);

      return ok({
        disposition,
        value: clone(message),
        conversationRevision: updatedConversation.revision,
      });
    });
  }

  async listMessages(
    scope: OrganizationScope,
    conversationId: string,
  ): Promise<Result<Message[]>> {
    const conversation = this.state.conversations.get(conversationId);
    if (!conversation || conversation.organizationId !== scope.organizationId) return ok([]);
    return ok(
      [...this.state.messages.values()]
        .filter((item) => item.conversationId === conversationId)
        .sort((left, right) => left.ordinal - right.ordinal)
        .map(clone),
    );
  }

  async saveAttachment(
    scope: OrganizationScope,
    input: Attachment,
  ): Promise<Result<WriteResult<Attachment>>> {
    const parsed = validate(attachmentSchema, input, "attachment");
    if (!parsed.ok) return parsed;
    const conversation = this.state.conversations.get(parsed.value.conversationId);
    if (!conversation || conversation.organizationId !== scope.organizationId) {
      return err(Errors.notFound("Conversation not found"));
    }
    const existing = this.state.attachments.get(parsed.value.id);
    if (existing) {
      if (same(existing, parsed.value)) {
        return ok({ disposition: "duplicate", value: clone(existing) });
      }
      return conflict("Attachment idempotency conflict");
    }
    this.state.attachments.set(parsed.value.id, clone(parsed.value));
    return ok({ disposition: "created", value: clone(parsed.value) });
  }

  async saveRun(
    scope: OrganizationScope,
    input: IngestionRun,
  ): Promise<Result<WriteResult<IngestionRun>>> {
    const parsed = validate(ingestionRunSchema, input, "ingestion run");
    if (!parsed.ok) return parsed;
    const owned = assertOrganization(scope, parsed.value.organizationId, "Ingestion run");
    if (!owned.ok) return owned;
    const existing = this.state.ingestionRuns.get(parsed.value.id);
    if (!existing) {
      this.state.ingestionRuns.set(parsed.value.id, clone(parsed.value));
      return ok({ disposition: "created", value: clone(parsed.value) });
    }
    if (existing.organizationId !== scope.organizationId) {
      return conflict("Ingestion run id is already in use");
    }
    if (same(existing, parsed.value)) {
      return ok({ disposition: "duplicate", value: clone(existing) });
    }
    this.state.ingestionRuns.set(parsed.value.id, clone(parsed.value));
    return ok({ disposition: "updated", value: clone(parsed.value) });
  }

  async getRun(
    scope: OrganizationScope,
    id: string,
  ): Promise<Result<IngestionRun | null>> {
    const run = this.state.ingestionRuns.get(id);
    if (!run || run.organizationId !== scope.organizationId) return ok(null);
    return ok(clone(run));
  }

  async claimEvent(
    scope: OrganizationScope,
    ingestionRunId: string,
    input: IngestionEvent,
  ): Promise<Result<ClaimEventResult>> {
    const parsed = validate(ingestionEventSchema, input, "ingestion event");
    if (!parsed.ok) return parsed;
    const run = this.state.ingestionRuns.get(ingestionRunId);
    if (!run || run.organizationId !== scope.organizationId) {
      return err(Errors.notFound("Ingestion run not found"));
    }

    return this.serial.run(
      `idempotency:${scope.organizationId}:${parsed.value.idempotencyKey}`,
      () => {
        const idempotencyKey = `${scope.organizationId}:${parsed.value.idempotencyKey}`;
        const existingEventId = this.state.eventIdempotency.get(idempotencyKey);
        if (existingEventId) {
          const existing = this.state.ingestionEvents.get(existingEventId);
          if (!existing) return err(Errors.internal("Idempotency index is corrupt"));
          if (!same(existing.event, parsed.value)) {
            return conflict("Idempotency key was reused with different event content");
          }
          return ok({
            disposition: "duplicate" as const,
            value: clone(existing.event),
            ingestionRunId: existing.ingestionRunId,
          });
        }

        const eventCollision = this.state.ingestionEvents.get(parsed.value.eventId);
        if (eventCollision) {
          return conflict("Event id is already in use");
        }

        this.state.ingestionEvents.set(parsed.value.eventId, {
          organizationId: scope.organizationId,
          ingestionRunId,
          event: clone(parsed.value),
        });
        this.state.eventIdempotency.set(idempotencyKey, parsed.value.eventId);
        return ok({
          disposition: "created" as const,
          value: clone(parsed.value),
          ingestionRunId,
        });
      },
    );
  }

  async markEventProcessed(
    scope: OrganizationScope,
    eventId: string,
    processingError?: string,
  ): Promise<Result<void>> {
    const existing = this.state.ingestionEvents.get(eventId);
    if (!existing || existing.organizationId !== scope.organizationId) {
      return err(Errors.notFound("Ingestion event not found"));
    }
    existing.processedAt = new Date().toISOString();
    if (processingError) existing.processingError = processingError;
    else delete existing.processingError;
    return ok(undefined);
  }

  async saveAuditRun(
    scope: OrganizationScope,
    input: AuditRun,
  ): Promise<Result<WriteResult<AuditRun>>> {
    const parsed = validate(auditRunSchema, input, "audit run");
    if (!parsed.ok) return parsed;
    const owned = assertOrganization(scope, parsed.value.organizationId, "Audit run");
    if (!owned.ok) return owned;
    return this.saveScopedRecord(this.state.auditRuns, parsed.value, scope, "Audit run");
  }

  async saveFinding(
    scope: OrganizationScope,
    input: Finding,
  ): Promise<Result<WriteResult<Finding>>> {
    const parsed = validate(findingSchema, input, "finding");
    if (!parsed.ok) return parsed;
    const owned = assertOrganization(scope, parsed.value.organizationId, "Finding");
    if (!owned.ok) return owned;

    const fingerprintCollision = [...this.state.findings.values()].find(
      (item) =>
        item.auditRunId === parsed.value.auditRunId &&
        item.fingerprint === parsed.value.fingerprint &&
        item.id !== parsed.value.id,
    );
    if (fingerprintCollision) {
      if (same(fingerprintCollision, parsed.value)) {
        return ok({ disposition: "duplicate", value: clone(fingerprintCollision) });
      }
      return conflict("Finding fingerprint is already in use");
    }
    return this.saveScopedRecord(this.state.findings, parsed.value, scope, "Finding");
  }

  async saveEvidence(
    scope: OrganizationScope,
    input: EvidenceRef,
  ): Promise<Result<WriteResult<EvidenceRef>>> {
    const parsed = validate(evidenceRefSchema, input, "finding evidence");
    if (!parsed.ok) return parsed;
    const finding = this.state.findings.get(parsed.value.findingId);
    if (!finding || finding.organizationId !== scope.organizationId) {
      return err(Errors.notFound("Finding not found"));
    }
    const existing = this.state.evidence.get(parsed.value.id);
    if (existing) {
      if (same(existing, parsed.value)) {
        return ok({ disposition: "duplicate", value: clone(existing) });
      }
      return conflict("Evidence idempotency conflict");
    }
    this.state.evidence.set(parsed.value.id, clone(parsed.value));
    return ok({ disposition: "created", value: clone(parsed.value) });
  }

  async saveObligation(
    scope: OrganizationScope,
    input: ObligationState,
  ): Promise<Result<WriteResult<ObligationState>>> {
    const parsed = validate(obligationStateSchema, input, "obligation");
    if (!parsed.ok) return parsed;
    const owned = assertOrganization(scope, parsed.value.organizationId, "Obligation");
    if (!owned.ok) return owned;
    return this.saveScopedRecord(
      this.state.obligations,
      parsed.value,
      scope,
      "Obligation",
    );
  }

  async saveArtifact(
    scope: OrganizationScope,
    input: AuditArtifact,
  ): Promise<Result<WriteResult<AuditArtifact>>> {
    const parsed = validate(auditArtifactSchema, input, "audit artifact");
    if (!parsed.ok) return parsed;
    const owned = assertOrganization(scope, parsed.value.organizationId, "Audit artifact");
    if (!owned.ok) return owned;
    return this.saveScopedRecord(
      this.state.artifacts,
      parsed.value,
      scope,
      "Audit artifact",
    );
  }

  async listFindings(
    scope: OrganizationScope,
    conversationId: string,
  ): Promise<Result<Finding[]>> {
    return ok(
      [...this.state.findings.values()]
        .filter(
          (item) =>
            item.organizationId === scope.organizationId &&
            item.conversationId === conversationId,
        )
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
        .map(clone),
    );
  }

  async put(
    input: PutPrivateObjectInput,
  ): Promise<Result<WriteResult<StoredObject>>> {
    const organization = assertSafeSegment(input.organizationId, "organizationId");
    if (!organization.ok) return organization;
    const objectId = assertSafeSegment(input.objectId, "objectId");
    if (!objectId.ok) return objectId;
    if (!input.mediaType.includes("/")) {
      return err(Errors.validation("mediaType must be a valid MIME type"));
    }

    const computedHash = createHash("sha256").update(input.bytes).digest("hex");
    if (input.contentHash && input.contentHash.toLowerCase() !== computedHash) {
      return err(Errors.validation("contentHash does not match object bytes"));
    }
    const fileName = safeFileName(input.fileName);
    const path = `${organization.value}/${objectId.value}/${computedHash}-${fileName}`;
    const key = objectKey(input.bucket, path);
    const existing = this.state.objects.get(key);
    if (existing) {
      return ok({ disposition: "duplicate", value: clone(existing.object) });
    }

    const object: StoredObject = {
      bucket: input.bucket,
      path,
      contentHash: computedHash,
      byteSize: input.bytes.byteLength,
      mediaType: input.mediaType,
    };
    this.state.objects.set(key, { object: clone(object), bytes: input.bytes.slice() });
    return ok({ disposition: "created", value: object });
  }

  async createReadUrl(
    scope: OrganizationScope,
    bucket: PrivateBucket,
    path: string,
    expiresInSeconds = 900,
  ): Promise<Result<string>> {
    const scoped = scopedPath(scope, path);
    if (!scoped.ok) return scoped;
    if (!Number.isInteger(expiresInSeconds) || expiresInSeconds < 60 || expiresInSeconds > 3600) {
      return err(Errors.validation("Signed URL expiry must be between 60 and 3600 seconds"));
    }
    if (!this.state.objects.has(objectKey(bucket, scoped.value))) {
      return err(Errors.notFound("Object not found"));
    }
    return ok(
      `memory://${bucket}/${encodeURI(scoped.value)}?expires=${Date.now() + expiresInSeconds * 1000}`,
    );
  }

  async remove(
    scope: OrganizationScope,
    bucket: PrivateBucket,
    path: string,
  ): Promise<Result<void>> {
    const scoped = scopedPath(scope, path);
    if (!scoped.ok) return scoped;
    this.state.objects.delete(objectKey(bucket, scoped.value));
    return ok(undefined);
  }

  private saveScopedRecord<T extends { id: string; organizationId: string }>(
    records: Map<string, T>,
    value: T,
    scope: OrganizationScope,
    label: string,
  ): Result<WriteResult<T>> {
    const existing = records.get(value.id);
    if (!existing) {
      records.set(value.id, clone(value));
      return ok({ disposition: "created", value: clone(value) });
    }
    if (existing.organizationId !== scope.organizationId) {
      return conflict(`${label} id is already in use`);
    }
    if (same(existing, value)) {
      return ok({ disposition: "duplicate", value: clone(existing) });
    }
    records.set(value.id, clone(value));
    return ok({ disposition: "updated", value: clone(value) });
  }
}

export function createMemoryRepositories(): RepositoryBundle {
  return new MemoryRepositories();
}
