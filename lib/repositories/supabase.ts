import "server-only";

import { createHash } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";
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
import { err, Errors, log, ok, type Result } from "@/lib/kernel";
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
import {
  attachmentFromRow,
  attachmentToRow,
  auditArtifactFromRow,
  auditArtifactToRow,
  auditRunFromRow,
  auditRunToRow,
  conversationFromRow,
  conversationToRow,
  evidenceFromRow,
  evidenceToRow,
  findingFromRow,
  findingToRow,
  ingestionEventFromRow,
  ingestionEventToRow,
  ingestionRunFromRow,
  ingestionRunToRow,
  messageFromRow,
  messageToRow,
  obligationFromRow,
  obligationToRow,
  participantFromRow,
  participantToRow,
  type DatabaseRow,
} from "@/lib/repositories/mappers";

const repositoryLog = log.child({ mod: "repositories.supabase" });

interface DatabaseErrorLike {
  message: string;
  code?: string;
  details?: string;
  hint?: string;
  status?: number;
  statusCode?: number | string;
}

interface RpcEnvelope {
  status?: unknown;
  reason?: unknown;
  actual_revision?: unknown;
  conversation_revision?: unknown;
  ingestion_run_id?: unknown;
  message?: unknown;
  event?: unknown;
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

function asRow(value: unknown): DatabaseRow {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as DatabaseRow)
    : {};
}

function asRows(value: unknown): DatabaseRow[] {
  return Array.isArray(value) ? value.map(asRow) : [];
}

function same(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function parseRow<T>(
  value: unknown,
  mapper: (row: DatabaseRow) => T,
  label: string,
): Result<T> {
  try {
    return ok(mapper(asRow(value)));
  } catch (cause) {
    return err(
      Errors.storage(`Stored ${label} failed schema validation`, {
        retriable: false,
        cause,
      }),
    );
  }
}

function parseRows<T>(
  value: unknown,
  mapper: (row: DatabaseRow) => T,
  label: string,
): Result<T[]> {
  const rows: T[] = [];
  for (const item of asRows(value)) {
    const parsed = parseRow(item, mapper, label);
    if (!parsed.ok) return parsed;
    rows.push(parsed.value);
  }
  return ok(rows);
}

function databaseError(
  operation: string,
  error: DatabaseErrorLike,
  context: Record<string, unknown> = {},
) {
  repositoryLog.warn("database operation failed", {
    operation,
    code: error.code,
    message: error.message,
    ...context,
  });
  if (error.code === "23505") {
    return Errors.conflict(`${operation} conflicted with an existing record`, {
      context,
    });
  }
  if (error.code === "23503" || error.code === "23514" || error.code === "22P02") {
    return Errors.validation(`${operation} violated a database invariant`, {
      context,
    });
  }
  return Errors.storage(`${operation} failed`, {
    retriable: error.code?.startsWith("08") ?? true,
    context: { ...context, code: error.code },
  });
}

function rpcFailure(envelope: RpcEnvelope, operation: string) {
  const status = String(envelope.status ?? "invalid");
  const reason = String(envelope.reason ?? status);
  if (status === "not_found") return Errors.notFound(`${operation}: record not found`);
  if (status === "conflict") {
    return Errors.conflict(`${operation}: ${reason}`, {
      context: {
        actualRevision: envelope.actual_revision,
      },
    });
  }
  return Errors.validation(`${operation}: ${reason}`);
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

function assertScopedPath(scope: OrganizationScope, path: string): Result<string> {
  const organization = assertSafeSegment(scope.organizationId, "organizationId");
  if (!organization.ok) return organization;
  if (!path.startsWith(`${organization.value}/`)) {
    return err(Errors.forbidden("Object path is outside this organization"));
  }
  return ok(path);
}

type ScopedMapper<T> = (row: DatabaseRow) => T;

export class SupabaseRepositories
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

  constructor(private readonly db: SupabaseClient) {}

  async createConversation(
    scope: OrganizationScope,
    input: Conversation,
  ): Promise<Result<WriteResult<Conversation>>> {
    const parsed = validate(conversationSchema, input, "conversation");
    if (!parsed.ok) return parsed;
    if (parsed.value.organizationId !== scope.organizationId) {
      return err(Errors.forbidden("Conversation organization mismatch"));
    }

    const inserted = await this.db
      .from("conversations")
      .insert(conversationToRow(parsed.value))
      .select("*")
      .single();
    if (!inserted.error) {
      const stored = parseRow(inserted.data, conversationFromRow, "conversation");
      return stored.ok
        ? ok({ disposition: "created", value: stored.value })
        : stored;
    }
    if (inserted.error.code !== "23505") {
      return err(databaseError("create conversation", inserted.error));
    }

    const existing = await this.db
      .from("conversations")
      .select("*")
      .eq("id", parsed.value.id)
      .eq("organization_id", scope.organizationId)
      .maybeSingle();
    if (existing.error) {
      return err(databaseError("read conflicting conversation", existing.error));
    }
    if (!existing.data) {
      return err(Errors.conflict("Conversation external key is already in use"));
    }
    const stored = parseRow(existing.data, conversationFromRow, "conversation");
    if (!stored.ok) return stored;
    if (!same(stored.value, parsed.value)) {
      return err(Errors.conflict("Conversation idempotency conflict"));
    }
    return ok({ disposition: "duplicate", value: stored.value });
  }

  async getConversation(
    scope: OrganizationScope,
    id: string,
  ): Promise<Result<Conversation | null>> {
    const response = await this.db
      .from("conversations")
      .select("*")
      .eq("organization_id", scope.organizationId)
      .eq("id", id)
      .maybeSingle();
    if (response.error) return err(databaseError("get conversation", response.error));
    if (!response.data) return ok(null);
    return parseRow(response.data, conversationFromRow, "conversation");
  }

  async listConversations(query: ConversationQuery): Promise<Result<Conversation[]>> {
    const limit = Math.min(Math.max(query.limit ?? 50, 1), 200);
    let request = this.db
      .from("conversations")
      .select("*")
      .eq("organization_id", query.organizationId)
      .order("last_activity_at", { ascending: false })
      .limit(limit);
    if (query.purpose) request = request.eq("purpose", query.purpose);
    if (query.channel) request = request.eq("channel", query.channel);
    if (query.processingState) {
      request = request.eq("processing_state", query.processingState);
    }
    if (query.before) request = request.lt("last_activity_at", query.before);
    const response = await request;
    if (response.error) return err(databaseError("list conversations", response.error));
    return parseRows(response.data, conversationFromRow, "conversation");
  }

  async upsertParticipant(
    scope: OrganizationScope,
    input: Participant,
  ): Promise<Result<WriteResult<Participant>>> {
    const parsed = validate(participantSchema, input, "participant");
    if (!parsed.ok) return parsed;
    const conversation = await this.getConversation(scope, parsed.value.conversationId);
    if (!conversation.ok) return conversation;
    if (!conversation.value) return err(Errors.notFound("Conversation not found"));

    return this.saveScopedRow(
      scope,
      "conversation_participants",
      parsed.value,
      participantToRow(scope.organizationId, parsed.value),
      participantFromRow,
      "participant",
      (existing, next) =>
        existing.conversationId === next.conversationId
          ? null
          : "Participant cannot move between conversations",
    );
  }

  async listParticipants(
    scope: OrganizationScope,
    conversationId: string,
  ): Promise<Result<Participant[]>> {
    const response = await this.db
      .from("conversation_participants")
      .select("*")
      .eq("organization_id", scope.organizationId)
      .eq("conversation_id", conversationId)
      .order("created_at");
    if (response.error) return err(databaseError("list participants", response.error));
    return parseRows(response.data, participantFromRow, "participant");
  }

  async putMessage(input: PutMessageInput): Promise<Result<PutMessageResult>> {
    const parsed = validate(messageSchema, input.message, "message");
    if (!parsed.ok) return parsed;
    const response = await this.db.rpc("put_conversation_message", {
      p_organization_id: input.organizationId,
      p_conversation_id: parsed.value.conversationId,
      p_expected_conversation_revision: input.expectedConversationRevision,
      p_message: messageToRow(input.organizationId, parsed.value),
    });
    if (response.error) {
      return err(databaseError("put conversation message", response.error));
    }
    const envelope = asRow(response.data) as RpcEnvelope;
    const status = String(envelope.status ?? "");
    if (status !== "created" && status !== "updated" && status !== "duplicate") {
      return err(rpcFailure(envelope, "put conversation message"));
    }
    const stored = parseRow(envelope.message, messageFromRow, "message");
    if (!stored.ok) return stored;
    const conversationRevision = Number(envelope.conversation_revision);
    if (!Number.isInteger(conversationRevision) || conversationRevision < 0) {
      return err(
        Errors.storage("Message RPC returned an invalid conversation revision", {
          retriable: false,
        }),
      );
    }
    return ok({
      disposition: status,
      value: stored.value,
      conversationRevision,
    });
  }

  async listMessages(
    scope: OrganizationScope,
    conversationId: string,
  ): Promise<Result<Message[]>> {
    const response = await this.db
      .from("messages")
      .select("*")
      .eq("organization_id", scope.organizationId)
      .eq("conversation_id", conversationId)
      .order("ordinal");
    if (response.error) return err(databaseError("list messages", response.error));
    return parseRows(response.data, messageFromRow, "message");
  }

  async saveAttachment(
    scope: OrganizationScope,
    input: Attachment,
  ): Promise<Result<WriteResult<Attachment>>> {
    const parsed = validate(attachmentSchema, input, "attachment");
    if (!parsed.ok) return parsed;
    const conversation = await this.getConversation(scope, parsed.value.conversationId);
    if (!conversation.ok) return conversation;
    if (!conversation.value) return err(Errors.notFound("Conversation not found"));
    return this.insertImmutableRow(
      scope,
      "attachments",
      parsed.value,
      attachmentToRow(scope.organizationId, parsed.value),
      attachmentFromRow,
      "attachment",
    );
  }

  async saveRun(
    scope: OrganizationScope,
    input: IngestionRun,
  ): Promise<Result<WriteResult<IngestionRun>>> {
    const parsed = validate(ingestionRunSchema, input, "ingestion run");
    if (!parsed.ok) return parsed;
    if (parsed.value.organizationId !== scope.organizationId) {
      return err(Errors.forbidden("Ingestion run organization mismatch"));
    }
    return this.saveScopedRow(
      scope,
      "ingestion_runs",
      parsed.value,
      ingestionRunToRow(parsed.value),
      ingestionRunFromRow,
      "ingestion run",
      (existing, next) =>
        existing.adapterId === next.adapterId &&
        existing.adapterVersion === next.adapterVersion &&
        existing.rawContentHash === next.rawContentHash
          ? null
          : "Ingestion run identity is immutable",
    );
  }

  async getRun(
    scope: OrganizationScope,
    id: string,
  ): Promise<Result<IngestionRun | null>> {
    const response = await this.db
      .from("ingestion_runs")
      .select("*")
      .eq("organization_id", scope.organizationId)
      .eq("id", id)
      .maybeSingle();
    if (response.error) return err(databaseError("get ingestion run", response.error));
    if (!response.data) return ok(null);
    return parseRow(response.data, ingestionRunFromRow, "ingestion run");
  }

  async claimEvent(
    scope: OrganizationScope,
    ingestionRunId: string,
    input: IngestionEvent,
  ): Promise<Result<ClaimEventResult>> {
    const parsed = validate(ingestionEventSchema, input, "ingestion event");
    if (!parsed.ok) return parsed;
    const response = await this.db.rpc("claim_ingestion_event", {
      p_organization_id: scope.organizationId,
      p_ingestion_run_id: ingestionRunId,
      p_event: ingestionEventToRow(scope.organizationId, ingestionRunId, parsed.value),
    });
    if (response.error) {
      return err(databaseError("claim ingestion event", response.error));
    }
    const envelope = asRow(response.data) as RpcEnvelope;
    const status = String(envelope.status ?? "");
    if (status !== "created" && status !== "duplicate") {
      return err(rpcFailure(envelope, "claim ingestion event"));
    }
    const stored = parseRow(envelope.event, ingestionEventFromRow, "ingestion event");
    if (!stored.ok) return stored;
    return ok({
      disposition: status,
      value: stored.value,
      ingestionRunId: String(envelope.ingestion_run_id),
    });
  }

  async markEventProcessed(
    scope: OrganizationScope,
    eventId: string,
    processingError?: string,
  ): Promise<Result<void>> {
    const response = await this.db
      .from("ingestion_events")
      .update({
        processed_at: new Date().toISOString(),
        processing_error: processingError ?? null,
      })
      .eq("organization_id", scope.organizationId)
      .eq("event_id", eventId)
      .select("event_id")
      .maybeSingle();
    if (response.error) {
      return err(databaseError("mark ingestion event processed", response.error));
    }
    if (!response.data) return err(Errors.notFound("Ingestion event not found"));
    return ok(undefined);
  }

  async saveAuditRun(
    scope: OrganizationScope,
    input: AuditRun,
  ): Promise<Result<WriteResult<AuditRun>>> {
    const parsed = validate(auditRunSchema, input, "audit run");
    if (!parsed.ok) return parsed;
    if (parsed.value.organizationId !== scope.organizationId) {
      return err(Errors.forbidden("Audit run organization mismatch"));
    }
    return this.saveScopedRow(
      scope,
      "audit_runs",
      parsed.value,
      auditRunToRow(parsed.value),
      auditRunFromRow,
      "audit run",
      (existing, next) =>
        existing.conversationId === next.conversationId &&
        existing.conversationRevision === next.conversationRevision &&
        existing.policyPackId === next.policyPackId &&
        existing.policyPackVersion === next.policyPackVersion
          ? null
          : "Audit run identity is immutable",
    );
  }

  async saveFinding(
    scope: OrganizationScope,
    input: Finding,
  ): Promise<Result<WriteResult<Finding>>> {
    const parsed = validate(findingSchema, input, "finding");
    if (!parsed.ok) return parsed;
    if (parsed.value.organizationId !== scope.organizationId) {
      return err(Errors.forbidden("Finding organization mismatch"));
    }
    return this.saveScopedRow(
      scope,
      "findings",
      parsed.value,
      findingToRow(parsed.value),
      findingFromRow,
      "finding",
      (existing, next) =>
        existing.conversationId === next.conversationId &&
        existing.auditRunId === next.auditRunId &&
        existing.fingerprint === next.fingerprint
          ? null
          : "Finding identity is immutable",
    );
  }

  async saveEvidence(
    scope: OrganizationScope,
    input: EvidenceRef,
  ): Promise<Result<WriteResult<EvidenceRef>>> {
    const parsed = validate(evidenceRefSchema, input, "finding evidence");
    if (!parsed.ok) return parsed;
    const finding = await this.db
      .from("findings")
      .select("id")
      .eq("organization_id", scope.organizationId)
      .eq("id", parsed.value.findingId)
      .maybeSingle();
    if (finding.error) return err(databaseError("verify evidence finding", finding.error));
    if (!finding.data) return err(Errors.notFound("Finding not found"));
    return this.insertImmutableRow(
      scope,
      "finding_evidence",
      parsed.value,
      evidenceToRow(scope.organizationId, parsed.value),
      evidenceFromRow,
      "finding evidence",
    );
  }

  async saveObligation(
    scope: OrganizationScope,
    input: ObligationState,
  ): Promise<Result<WriteResult<ObligationState>>> {
    const parsed = validate(obligationStateSchema, input, "obligation");
    if (!parsed.ok) return parsed;
    if (parsed.value.organizationId !== scope.organizationId) {
      return err(Errors.forbidden("Obligation organization mismatch"));
    }
    return this.saveScopedRow(
      scope,
      "obligation_states",
      parsed.value,
      obligationToRow(parsed.value),
      obligationFromRow,
      "obligation",
      (existing, next) =>
        existing.conversationId === next.conversationId &&
        existing.conversationRevision === next.conversationRevision &&
        existing.checkDefinitionId === next.checkDefinitionId
          ? null
          : "Obligation identity is immutable",
    );
  }

  async saveArtifact(
    scope: OrganizationScope,
    input: AuditArtifact,
  ): Promise<Result<WriteResult<AuditArtifact>>> {
    const parsed = validate(auditArtifactSchema, input, "audit artifact");
    if (!parsed.ok) return parsed;
    if (parsed.value.organizationId !== scope.organizationId) {
      return err(Errors.forbidden("Audit artifact organization mismatch"));
    }
    return this.saveScopedRow(
      scope,
      "audit_artifacts",
      parsed.value,
      auditArtifactToRow(parsed.value),
      auditArtifactFromRow,
      "audit artifact",
      (existing, next) =>
        existing.conversationId === next.conversationId &&
        existing.auditRunId === next.auditRunId &&
        existing.audience === next.audience
          ? null
          : "Audit artifact identity is immutable",
    );
  }

  async listFindings(
    scope: OrganizationScope,
    conversationId: string,
  ): Promise<Result<Finding[]>> {
    const response = await this.db
      .from("findings")
      .select("*")
      .eq("organization_id", scope.organizationId)
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: false });
    if (response.error) return err(databaseError("list findings", response.error));
    return parseRows(response.data, findingFromRow, "finding");
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

    const contentHash = createHash("sha256").update(input.bytes).digest("hex");
    if (input.contentHash && input.contentHash.toLowerCase() !== contentHash) {
      return err(Errors.validation("contentHash does not match object bytes"));
    }
    const path = `${organization.value}/${objectId.value}/${contentHash}-${safeFileName(input.fileName)}`;
    const object: StoredObject = {
      bucket: input.bucket,
      path,
      contentHash,
      byteSize: input.bytes.byteLength,
      mediaType: input.mediaType,
    };

    const response = await this.db.storage.from(input.bucket).upload(path, input.bytes, {
      cacheControl: "private, max-age=31536000, immutable",
      contentType: input.mediaType,
      upsert: false,
    });
    if (!response.error) return ok({ disposition: "created", value: object });

    const status = Number(
      (response.error as DatabaseErrorLike).statusCode ??
        (response.error as DatabaseErrorLike).status,
    );
    if (
      status === 409 ||
      /already exists|duplicate/i.test(response.error.message)
    ) {
      return ok({ disposition: "duplicate", value: object });
    }
    return err(
      databaseError("upload private object", response.error as DatabaseErrorLike, {
        bucket: input.bucket,
      }),
    );
  }

  async createReadUrl(
    scope: OrganizationScope,
    bucket: PrivateBucket,
    path: string,
    expiresInSeconds = 900,
  ): Promise<Result<string>> {
    const scoped = assertScopedPath(scope, path);
    if (!scoped.ok) return scoped;
    if (!Number.isInteger(expiresInSeconds) || expiresInSeconds < 60 || expiresInSeconds > 3600) {
      return err(Errors.validation("Signed URL expiry must be between 60 and 3600 seconds"));
    }
    const response = await this.db.storage
      .from(bucket)
      .createSignedUrl(scoped.value, expiresInSeconds);
    if (response.error) {
      return err(
        databaseError("create signed object URL", response.error as DatabaseErrorLike, {
          bucket,
        }),
      );
    }
    return ok(response.data.signedUrl);
  }

  async remove(
    scope: OrganizationScope,
    bucket: PrivateBucket,
    path: string,
  ): Promise<Result<void>> {
    const scoped = assertScopedPath(scope, path);
    if (!scoped.ok) return scoped;
    const response = await this.db.storage.from(bucket).remove([scoped.value]);
    if (response.error) {
      return err(
        databaseError("remove private object", response.error as DatabaseErrorLike, {
          bucket,
        }),
      );
    }
    return ok(undefined);
  }

  private async insertImmutableRow<T extends { id: string }>(
    scope: OrganizationScope,
    table: string,
    value: T,
    row: DatabaseRow,
    mapper: ScopedMapper<T>,
    label: string,
  ): Promise<Result<WriteResult<T>>> {
    const inserted = await this.db.from(table).insert(row).select("*").single();
    if (!inserted.error) {
      const stored = parseRow(inserted.data, mapper, label);
      return stored.ok
        ? ok({ disposition: "created", value: stored.value })
        : stored;
    }
    if (inserted.error.code !== "23505") {
      return err(databaseError(`create ${label}`, inserted.error));
    }

    const existing = await this.db
      .from(table)
      .select("*")
      .eq("id", value.id)
      .maybeSingle();
    if (existing.error) return err(databaseError(`read conflicting ${label}`, existing.error));
    if (!existing.data || asRow(existing.data).organization_id !== scope.organizationId) {
      return err(Errors.conflict(`${label} id or unique key is already in use`));
    }
    const stored = parseRow(existing.data, mapper, label);
    if (!stored.ok) return stored;
    if (!same(stored.value, value)) {
      return err(Errors.conflict(`${label} idempotency conflict`));
    }
    return ok({ disposition: "duplicate", value: stored.value });
  }

  private async saveScopedRow<T extends { id: string }>(
    scope: OrganizationScope,
    table: string,
    value: T,
    row: DatabaseRow,
    mapper: ScopedMapper<T>,
    label: string,
    validateIdentity?: (existing: T, next: T) => string | null,
  ): Promise<Result<WriteResult<T>>> {
    const existing = await this.db
      .from(table)
      .select("*")
      .eq("id", value.id)
      .maybeSingle();
    if (existing.error) return err(databaseError(`read ${label}`, existing.error));

    if (!existing.data) {
      const inserted = await this.db.from(table).insert(row).select("*").single();
      if (inserted.error) {
        if (inserted.error.code === "23505") {
          return err(Errors.conflict(`${label} unique key is already in use`));
        }
        return err(databaseError(`create ${label}`, inserted.error));
      }
      const stored = parseRow(inserted.data, mapper, label);
      return stored.ok
        ? ok({ disposition: "created", value: stored.value })
        : stored;
    }

    const existingRow = asRow(existing.data);
    if (existingRow.organization_id !== scope.organizationId) {
      return err(Errors.conflict(`${label} id is already in use`));
    }
    const stored = parseRow(existing.data, mapper, label);
    if (!stored.ok) return stored;
    if (same(stored.value, value)) {
      return ok({ disposition: "duplicate", value: stored.value });
    }
    const identityError = validateIdentity?.(stored.value, value);
    if (identityError) return err(Errors.conflict(identityError));

    const updated = await this.db
      .from(table)
      .update(row)
      .eq("id", value.id)
      .eq("organization_id", scope.organizationId)
      .select("*")
      .single();
    if (updated.error) return err(databaseError(`update ${label}`, updated.error));
    const parsed = parseRow(updated.data, mapper, label);
    return parsed.ok
      ? ok({ disposition: "updated", value: parsed.value })
      : parsed;
  }
}
