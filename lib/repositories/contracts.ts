import type { AuditArtifact, AuditRun, EvidenceRef, Finding, ObligationState } from "@/lib/compliance/types";
import type {
  Attachment,
  Conversation,
  Message,
  Participant,
} from "@/lib/conversations/types";
import type { IngestionEvent, IngestionRun } from "@/lib/ingestion/types";
import type { Result } from "@/lib/kernel";

export interface OrganizationScope {
  organizationId: string;
}

export type WriteDisposition = "created" | "updated" | "duplicate";

export interface WriteResult<T> {
  disposition: WriteDisposition;
  value: T;
}

export interface ConversationQuery extends OrganizationScope {
  purpose?: Conversation["purpose"];
  channel?: Conversation["channel"];
  processingState?: Conversation["processingState"];
  limit?: number;
  before?: string;
}

export interface PutMessageInput extends OrganizationScope {
  message: Message;
  /**
   * Optimistic concurrency token read from Conversation.revision.
   * Exact retries are recognized before this comparison and remain idempotent.
   */
  expectedConversationRevision: number;
}

export interface PutMessageResult extends WriteResult<Message> {
  conversationRevision: number;
}

export interface ConversationRepository {
  createConversation(
    scope: OrganizationScope,
    conversation: Conversation,
  ): Promise<Result<WriteResult<Conversation>>>;
  getConversation(scope: OrganizationScope, id: string): Promise<Result<Conversation | null>>;
  listConversations(query: ConversationQuery): Promise<Result<Conversation[]>>;
  upsertParticipant(
    scope: OrganizationScope,
    participant: Participant,
  ): Promise<Result<WriteResult<Participant>>>;
  listParticipants(
    scope: OrganizationScope,
    conversationId: string,
  ): Promise<Result<Participant[]>>;
  putMessage(input: PutMessageInput): Promise<Result<PutMessageResult>>;
  listMessages(
    scope: OrganizationScope,
    conversationId: string,
  ): Promise<Result<Message[]>>;
  saveAttachment(
    scope: OrganizationScope,
    attachment: Attachment,
  ): Promise<Result<WriteResult<Attachment>>>;
}

export interface ClaimEventResult extends WriteResult<IngestionEvent> {
  ingestionRunId: string;
}

export interface IngestionRepository {
  saveRun(
    scope: OrganizationScope,
    run: IngestionRun,
  ): Promise<Result<WriteResult<IngestionRun>>>;
  getRun(scope: OrganizationScope, id: string): Promise<Result<IngestionRun | null>>;
  claimEvent(
    scope: OrganizationScope,
    ingestionRunId: string,
    event: IngestionEvent,
  ): Promise<Result<ClaimEventResult>>;
  markEventProcessed(
    scope: OrganizationScope,
    eventId: string,
    processingError?: string,
  ): Promise<Result<void>>;
}

export interface ComplianceRepository {
  saveAuditRun(
    scope: OrganizationScope,
    run: AuditRun,
  ): Promise<Result<WriteResult<AuditRun>>>;
  saveFinding(
    scope: OrganizationScope,
    finding: Finding,
  ): Promise<Result<WriteResult<Finding>>>;
  saveEvidence(
    scope: OrganizationScope,
    evidence: EvidenceRef,
  ): Promise<Result<WriteResult<EvidenceRef>>>;
  saveObligation(
    scope: OrganizationScope,
    obligation: ObligationState,
  ): Promise<Result<WriteResult<ObligationState>>>;
  saveArtifact(
    scope: OrganizationScope,
    artifact: AuditArtifact,
  ): Promise<Result<WriteResult<AuditArtifact>>>;
  listFindings(
    scope: OrganizationScope,
    conversationId: string,
  ): Promise<Result<Finding[]>>;
}

export const privateBucketNames = [
  "raw-ingestion",
  "conversation-attachments",
  "reference-documents",
  "audit-audio",
] as const;
export type PrivateBucket = (typeof privateBucketNames)[number];

export interface PutPrivateObjectInput extends OrganizationScope {
  bucket: PrivateBucket;
  objectId: string;
  fileName: string;
  mediaType: string;
  bytes: Uint8Array;
  contentHash?: string;
}

export interface StoredObject {
  bucket: PrivateBucket;
  path: string;
  contentHash: string;
  byteSize: number;
  mediaType: string;
}

export interface PrivateObjectRepository {
  put(input: PutPrivateObjectInput): Promise<Result<WriteResult<StoredObject>>>;
  createReadUrl(
    scope: OrganizationScope,
    bucket: PrivateBucket,
    path: string,
    expiresInSeconds?: number,
  ): Promise<Result<string>>;
  remove(
    scope: OrganizationScope,
    bucket: PrivateBucket,
    path: string,
  ): Promise<Result<void>>;
}

export interface RepositoryBundle {
  conversations: ConversationRepository;
  ingestion: IngestionRepository;
  compliance: ComplianceRepository;
  objects: PrivateObjectRepository;
}
