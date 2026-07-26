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

export type DatabaseRow = Record<string, unknown>;

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : [];
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function numberRecord(value: unknown): Record<string, number> {
  return Object.fromEntries(
    Object.entries(record(value))
      .map(([key, item]) => [key, Number(item)] as const)
      .filter((entry) => Number.isFinite(entry[1])),
  );
}

function optionalString(value: unknown): string | undefined {
  return value === null || value === undefined || value === "" ? undefined : String(value);
}

function requiredString(value: unknown): string {
  return String(value);
}

export function conversationToRow(value: Conversation): DatabaseRow {
  return {
    id: value.id,
    organization_id: value.organizationId,
    channel: value.channel,
    ingestion_mode: value.ingestionMode,
    purpose: value.purpose,
    lifecycle: value.lifecycle,
    processing_state: value.processingState,
    product_id: value.productId ?? null,
    policy_pack_ids: value.policyPackIds,
    external_thread_key: value.externalThreadKey ?? null,
    customer_language: value.customerLanguage ?? null,
    title: value.title ?? null,
    started_at: value.startedAt ?? null,
    last_activity_at: value.lastActivityAt,
    closed_at: value.closedAt ?? null,
    revision: value.revision,
    metadata: value.metadata,
    created_at: value.createdAt,
    updated_at: value.updatedAt,
  };
}

export function conversationFromRow(row: DatabaseRow): Conversation {
  return conversationSchema.parse({
    id: requiredString(row.id),
    organizationId: requiredString(row.organization_id),
    channel: row.channel,
    ingestionMode: row.ingestion_mode,
    purpose: row.purpose,
    lifecycle: row.lifecycle,
    processingState: row.processing_state,
    productId: optionalString(row.product_id),
    policyPackIds: strings(row.policy_pack_ids),
    externalThreadKey: optionalString(row.external_thread_key),
    customerLanguage: optionalString(row.customer_language),
    title: optionalString(row.title),
    startedAt: optionalString(row.started_at),
    lastActivityAt: requiredString(row.last_activity_at),
    closedAt: optionalString(row.closed_at),
    revision: Number(row.revision),
    metadata: record(row.metadata),
    createdAt: requiredString(row.created_at),
    updatedAt: requiredString(row.updated_at),
  });
}

export function participantToRow(
  organizationId: string,
  value: Participant,
): DatabaseRow {
  return {
    id: value.id,
    organization_id: organizationId,
    conversation_id: value.conversationId,
    role: value.role,
    display_name: value.displayName ?? null,
    external_id: value.externalId ?? null,
    role_confidence: value.roleConfidence,
    metadata: value.metadata,
    created_at: value.createdAt,
    updated_at: value.updatedAt,
  };
}

export function participantFromRow(row: DatabaseRow): Participant {
  return participantSchema.parse({
    id: requiredString(row.id),
    conversationId: requiredString(row.conversation_id),
    role: row.role,
    displayName: optionalString(row.display_name),
    externalId: optionalString(row.external_id),
    roleConfidence: Number(row.role_confidence),
    metadata: record(row.metadata),
    createdAt: requiredString(row.created_at),
    updatedAt: requiredString(row.updated_at),
  });
}

export function messageToRow(organizationId: string, value: Message): DatabaseRow {
  return {
    id: value.id,
    organization_id: organizationId,
    conversation_id: value.conversationId,
    participant_id: value.participantId ?? null,
    external_message_id: value.externalMessageId ?? null,
    revision: value.revision,
    direction: value.direction,
    visibility: value.visibility,
    state: value.state,
    modality: value.modality,
    original_text: value.originalText,
    normalized_text: value.normalizedText,
    language: value.language ?? null,
    occurred_at: value.occurredAt ?? null,
    received_at: value.receivedAt,
    ordinal: value.ordinal,
    reply_to_message_id: value.replyToMessageId ?? null,
    confidence: value.confidence ?? null,
    source_hash: value.sourceHash,
    metadata: value.metadata,
    created_at: value.createdAt,
    updated_at: value.updatedAt,
  };
}

export function messageFromRow(row: DatabaseRow): Message {
  return messageSchema.parse({
    id: requiredString(row.id),
    conversationId: requiredString(row.conversation_id),
    participantId: optionalString(row.participant_id),
    externalMessageId: optionalString(row.external_message_id),
    revision: Number(row.revision),
    direction: row.direction,
    visibility: row.visibility,
    state: row.state,
    modality: row.modality,
    originalText: requiredString(row.original_text ?? ""),
    normalizedText: requiredString(row.normalized_text ?? ""),
    language: optionalString(row.language),
    occurredAt: optionalString(row.occurred_at),
    receivedAt: requiredString(row.received_at),
    ordinal: Number(row.ordinal),
    replyToMessageId: optionalString(row.reply_to_message_id),
    confidence:
      row.confidence === null || row.confidence === undefined
        ? undefined
        : Number(row.confidence),
    sourceHash: requiredString(row.source_hash),
    metadata: record(row.metadata),
    createdAt: requiredString(row.created_at),
    updatedAt: requiredString(row.updated_at),
  });
}

export function attachmentToRow(
  organizationId: string,
  value: Attachment,
): DatabaseRow {
  return {
    id: value.id,
    organization_id: organizationId,
    conversation_id: value.conversationId,
    message_id: value.messageId ?? null,
    file_name: value.fileName,
    media_type: value.mediaType,
    byte_size: value.byteSize,
    content_hash: value.contentHash,
    storage_path: value.storagePath,
    extraction_state: value.extractionState,
    extracted_text: value.extractedText ?? null,
    metadata: value.metadata,
    created_at: value.createdAt,
  };
}

export function attachmentFromRow(row: DatabaseRow): Attachment {
  return attachmentSchema.parse({
    id: requiredString(row.id),
    conversationId: requiredString(row.conversation_id),
    messageId: optionalString(row.message_id),
    fileName: requiredString(row.file_name),
    mediaType: requiredString(row.media_type),
    byteSize: Number(row.byte_size),
    contentHash: requiredString(row.content_hash),
    storagePath: requiredString(row.storage_path),
    extractionState: row.extraction_state,
    extractedText: optionalString(row.extracted_text),
    metadata: record(row.metadata),
    createdAt: requiredString(row.created_at),
  });
}

export function ingestionRunToRow(value: IngestionRun): DatabaseRow {
  return {
    id: value.id,
    organization_id: value.organizationId,
    adapter_id: value.adapterId,
    adapter_version: value.adapterVersion,
    channel: value.channel,
    ingestion_mode: value.ingestionMode,
    purpose: value.purpose,
    status: value.status,
    raw_artifact_path: value.rawArtifactPath ?? null,
    raw_content_hash: value.rawContentHash,
    event_count: value.eventCount,
    issue_count: value.issueCount,
    created_at: value.createdAt,
    completed_at: value.completedAt ?? null,
  };
}

export function ingestionRunFromRow(row: DatabaseRow): IngestionRun {
  return ingestionRunSchema.parse({
    id: requiredString(row.id),
    organizationId: requiredString(row.organization_id),
    adapterId: requiredString(row.adapter_id),
    adapterVersion: requiredString(row.adapter_version),
    channel: row.channel,
    ingestionMode: row.ingestion_mode,
    purpose: row.purpose,
    status: row.status,
    rawArtifactPath: optionalString(row.raw_artifact_path),
    rawContentHash: requiredString(row.raw_content_hash),
    eventCount: Number(row.event_count),
    issueCount: Number(row.issue_count),
    createdAt: requiredString(row.created_at),
    completedAt: optionalString(row.completed_at),
  });
}

export function ingestionEventToRow(
  organizationId: string,
  ingestionRunId: string,
  value: IngestionEvent,
): DatabaseRow {
  return {
    event_id: value.eventId,
    organization_id: organizationId,
    ingestion_run_id: ingestionRunId,
    schema_version: value.schemaVersion,
    adapter_id: value.adapterId,
    adapter_version: value.adapterVersion,
    idempotency_key: value.idempotencyKey,
    external_conversation_key: value.externalConversationKey ?? null,
    occurred_at: value.occurredAt ?? null,
    received_at: value.receivedAt,
    sequence: value.sequence ?? null,
    event_type: value.type,
    payload: value.payload,
    raw_artifact_ref: value.rawArtifactRef ?? null,
  };
}

export function ingestionEventFromRow(row: DatabaseRow): IngestionEvent {
  return ingestionEventSchema.parse({
    schemaVersion: Number(row.schema_version),
    eventId: requiredString(row.event_id),
    adapterId: requiredString(row.adapter_id),
    adapterVersion: requiredString(row.adapter_version),
    idempotencyKey: requiredString(row.idempotency_key),
    externalConversationKey: optionalString(row.external_conversation_key),
    occurredAt: optionalString(row.occurred_at),
    receivedAt: requiredString(row.received_at),
    sequence:
      row.sequence === null || row.sequence === undefined ? undefined : Number(row.sequence),
    type: row.event_type,
    payload: record(row.payload),
    rawArtifactRef: optionalString(row.raw_artifact_ref),
  });
}

export function auditRunToRow(value: AuditRun): DatabaseRow {
  return {
    id: value.id,
    organization_id: value.organizationId,
    conversation_id: value.conversationId,
    conversation_revision: value.conversationRevision,
    policy_pack_id: value.policyPackId,
    policy_pack_version: value.policyPackVersion,
    knowledge_snapshot: value.knowledgeSnapshot,
    trigger: value.trigger,
    status: value.status,
    started_at: value.startedAt,
    completed_at: value.completedAt ?? null,
    degraded_reasons: value.degradedReasons,
    metrics: value.metrics,
    created_at: value.createdAt,
  };
}

export function auditRunFromRow(row: DatabaseRow): AuditRun {
  return auditRunSchema.parse({
    id: requiredString(row.id),
    organizationId: requiredString(row.organization_id),
    conversationId: requiredString(row.conversation_id),
    conversationRevision: Number(row.conversation_revision),
    policyPackId: requiredString(row.policy_pack_id),
    policyPackVersion: Number(row.policy_pack_version),
    knowledgeSnapshot: numberRecord(row.knowledge_snapshot),
    trigger: row.trigger,
    status: row.status,
    startedAt: requiredString(row.started_at),
    completedAt: optionalString(row.completed_at),
    degradedReasons: strings(row.degraded_reasons),
    metrics: numberRecord(row.metrics),
    createdAt: requiredString(row.created_at),
  });
}

export function findingToRow(value: Finding): DatabaseRow {
  return {
    id: value.id,
    organization_id: value.organizationId,
    conversation_id: value.conversationId,
    audit_run_id: value.auditRunId,
    check_definition_id: value.checkDefinitionId,
    fingerprint: value.fingerprint,
    kind: value.kind,
    outcome: value.outcome,
    lifecycle: value.lifecycle,
    severity: value.severity,
    title: value.title,
    explanation: value.explanation,
    coach_suggestion: value.coachSuggestion ?? null,
    implicated_message_ids: value.implicatedMessageIds,
    confidence: value.confidence,
    source: value.source,
    provider: value.provider ?? null,
    model: value.model ?? null,
    prompt_version: value.promptVersion ?? null,
    latency_ms: value.latencyMs ?? null,
    reviewed_at: value.reviewedAt ?? null,
    reviewed_by: value.reviewedBy ?? null,
    review_note: value.reviewNote ?? null,
    created_at: value.createdAt,
    updated_at: value.updatedAt,
  };
}

export function findingFromRow(row: DatabaseRow): Finding {
  return findingSchema.parse({
    id: requiredString(row.id),
    organizationId: requiredString(row.organization_id),
    conversationId: requiredString(row.conversation_id),
    auditRunId: requiredString(row.audit_run_id),
    checkDefinitionId: requiredString(row.check_definition_id),
    fingerprint: requiredString(row.fingerprint),
    kind: row.kind,
    outcome: row.outcome,
    lifecycle: row.lifecycle,
    severity: row.severity,
    title: requiredString(row.title),
    explanation: requiredString(row.explanation),
    coachSuggestion: optionalString(row.coach_suggestion),
    implicatedMessageIds: strings(row.implicated_message_ids),
    confidence: Number(row.confidence),
    source: row.source,
    provider: optionalString(row.provider),
    model: optionalString(row.model),
    promptVersion: optionalString(row.prompt_version),
    latencyMs:
      row.latency_ms === null || row.latency_ms === undefined
        ? undefined
        : Number(row.latency_ms),
    reviewedAt: optionalString(row.reviewed_at),
    reviewedBy: optionalString(row.reviewed_by),
    reviewNote: optionalString(row.review_note),
    createdAt: requiredString(row.created_at),
    updatedAt: requiredString(row.updated_at),
  });
}

export function evidenceToRow(
  organizationId: string,
  value: EvidenceRef,
): DatabaseRow {
  return {
    id: value.id,
    organization_id: organizationId,
    finding_id: value.findingId,
    evidence_type: value.evidenceType,
    message_id: value.messageId ?? null,
    document_chunk_id: value.documentChunkId ?? null,
    compliance_fact_id: value.complianceFactId ?? null,
    start_offset: value.startOffset ?? null,
    end_offset: value.endOffset ?? null,
    quote: value.quote,
    metadata: value.metadata,
    created_at: value.createdAt,
  };
}

export function evidenceFromRow(row: DatabaseRow): EvidenceRef {
  return evidenceRefSchema.parse({
    id: requiredString(row.id),
    findingId: requiredString(row.finding_id),
    evidenceType: row.evidence_type,
    messageId: optionalString(row.message_id),
    documentChunkId: optionalString(row.document_chunk_id),
    complianceFactId: optionalString(row.compliance_fact_id),
    startOffset:
      row.start_offset === null || row.start_offset === undefined
        ? undefined
        : Number(row.start_offset),
    endOffset:
      row.end_offset === null || row.end_offset === undefined
        ? undefined
        : Number(row.end_offset),
    quote: requiredString(row.quote),
    metadata: record(row.metadata),
    createdAt: requiredString(row.created_at),
  });
}

export function obligationToRow(value: ObligationState): DatabaseRow {
  return {
    id: value.id,
    organization_id: value.organizationId,
    conversation_id: value.conversationId,
    conversation_revision: value.conversationRevision,
    check_definition_id: value.checkDefinitionId,
    status: value.status,
    satisfaction_message_ids: value.satisfactionMessageIds,
    confidence: value.confidence,
    derived_at: value.derivedAt,
  };
}

export function obligationFromRow(row: DatabaseRow): ObligationState {
  return obligationStateSchema.parse({
    id: requiredString(row.id),
    organizationId: requiredString(row.organization_id),
    conversationId: requiredString(row.conversation_id),
    conversationRevision: Number(row.conversation_revision),
    checkDefinitionId: requiredString(row.check_definition_id),
    status: row.status,
    satisfactionMessageIds: strings(row.satisfaction_message_ids),
    confidence: Number(row.confidence),
    derivedAt: requiredString(row.derived_at),
  });
}

export function auditArtifactToRow(value: AuditArtifact): DatabaseRow {
  return {
    id: value.id,
    organization_id: value.organizationId,
    conversation_id: value.conversationId,
    audit_run_id: value.auditRunId,
    audience: value.audience,
    language: value.language,
    summary: value.summary,
    promised: value.promised,
    actual: value.actual,
    gaps: value.gaps,
    audio_storage_path: value.audioStoragePath ?? null,
    created_at: value.createdAt,
  };
}

export function auditArtifactFromRow(row: DatabaseRow): AuditArtifact {
  return auditArtifactSchema.parse({
    id: requiredString(row.id),
    organizationId: requiredString(row.organization_id),
    conversationId: requiredString(row.conversation_id),
    auditRunId: requiredString(row.audit_run_id),
    audience: row.audience,
    language: requiredString(row.language),
    summary: requiredString(row.summary ?? ""),
    promised: strings(row.promised),
    actual: strings(row.actual),
    gaps: strings(row.gaps),
    audioStoragePath: optionalString(row.audio_storage_path),
    createdAt: requiredString(row.created_at),
  });
}
