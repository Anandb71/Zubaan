import assert from "node:assert/strict";
import test from "node:test";

import type { Conversation, Message } from "@/lib/conversations/types";
import type { IngestionEvent, IngestionRun } from "@/lib/ingestion/types";
import { MemoryRepositories } from "@/lib/repositories/memory";

const ORGANIZATION_ID = "00000000-0000-0000-0000-000000000010";
const OTHER_ORGANIZATION_ID = "00000000-0000-0000-0000-000000000020";
const NOW = "2026-07-26T08:00:00.000Z";

function conversation(overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: "conversation-1",
    organizationId: ORGANIZATION_ID,
    channel: "whatsapp",
    ingestionMode: "api",
    purpose: "sales",
    lifecycle: "open",
    processingState: "idle",
    policyPackIds: [],
    lastActivityAt: NOW,
    revision: 0,
    metadata: {},
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function message(id: string, ordinal: number, overrides: Partial<Message> = {}): Message {
  return {
    id,
    conversationId: "conversation-1",
    revision: 0,
    direction: "outbound",
    visibility: "customer_visible",
    state: "sent",
    modality: "text",
    originalText: `Message ${ordinal}`,
    normalizedText: `message ${ordinal}`,
    receivedAt: NOW,
    ordinal,
    sourceHash: `hash-${id}`,
    metadata: {},
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function ingestionRun(): IngestionRun {
  return {
    id: "run-1",
    organizationId: ORGANIZATION_ID,
    adapterId: "whatsapp-cloud",
    adapterVersion: "1.0.0",
    channel: "whatsapp",
    ingestionMode: "api",
    purpose: "sales",
    status: "processing",
    rawContentHash: "raw-hash",
    eventCount: 0,
    issueCount: 0,
    createdAt: NOW,
  };
}

function ingestionEvent(payload: Record<string, unknown> = { text: "hello" }): IngestionEvent {
  return {
    schemaVersion: 1,
    eventId: "event-1",
    adapterId: "whatsapp-cloud",
    adapterVersion: "1.0.0",
    idempotencyKey: "wa:message:123",
    receivedAt: NOW,
    type: "message.upserted",
    payload,
  };
}

test("conversation creation is idempotent and organization scoped", async () => {
  const repositories = new MemoryRepositories();
  const created = await repositories.createConversation(
    { organizationId: ORGANIZATION_ID },
    conversation(),
  );
  assert.equal(created.ok, true);
  if (!created.ok) return;
  assert.equal(created.value.disposition, "created");

  const retry = await repositories.createConversation(
    { organizationId: ORGANIZATION_ID },
    conversation(),
  );
  assert.equal(retry.ok, true);
  if (!retry.ok) return;
  assert.equal(retry.value.disposition, "duplicate");

  const hidden = await repositories.getConversation(
    { organizationId: OTHER_ORGANIZATION_ID },
    "conversation-1",
  );
  assert.deepEqual(hidden, { ok: true, value: null });
});

test("concurrent writes enforce optimistic conversation revisions", async () => {
  const repositories = new MemoryRepositories();
  await repositories.createConversation(
    { organizationId: ORGANIZATION_ID },
    conversation(),
  );

  const results = await Promise.all([
    repositories.putMessage({
      organizationId: ORGANIZATION_ID,
      expectedConversationRevision: 0,
      message: message("message-1", 0),
    }),
    repositories.putMessage({
      organizationId: ORGANIZATION_ID,
      expectedConversationRevision: 0,
      message: message("message-2", 1),
    }),
  ]);

  assert.equal(results.filter((result) => result.ok).length, 1);
  const rejected = results.find((result) => !result.ok);
  assert.ok(rejected && !rejected.ok);
  assert.equal(rejected.error.kind, "conflict");

  const stored = await repositories.listMessages(
    { organizationId: ORGANIZATION_ID },
    "conversation-1",
  );
  assert.equal(stored.ok && stored.value.length, 1);
});

test("an exact message retry is idempotent even with a stale expected revision", async () => {
  const repositories = new MemoryRepositories();
  await repositories.createConversation(
    { organizationId: ORGANIZATION_ID },
    conversation(),
  );
  const input = {
    organizationId: ORGANIZATION_ID,
    expectedConversationRevision: 0,
    message: message("message-1", 0),
  };

  const first = await repositories.putMessage(input);
  assert.equal(first.ok && first.value.disposition, "created");
  const retry = await repositories.putMessage(input);
  assert.equal(retry.ok && retry.value.disposition, "duplicate");
  assert.equal(retry.ok && retry.value.conversationRevision, 1);
});

test("message edits require a monotonic revision and immutable ordinal", async () => {
  const repositories = new MemoryRepositories();
  await repositories.createConversation(
    { organizationId: ORGANIZATION_ID },
    conversation(),
  );
  await repositories.putMessage({
    organizationId: ORGANIZATION_ID,
    expectedConversationRevision: 0,
    message: message("message-1", 0),
  });

  const edited = message("message-1", 0, {
    revision: 1,
    state: "edited",
    originalText: "Corrected promise",
    normalizedText: "corrected promise",
    sourceHash: "hash-message-1-edit-1",
    updatedAt: "2026-07-26T08:01:00.000Z",
  });
  const result = await repositories.putMessage({
    organizationId: ORGANIZATION_ID,
    expectedConversationRevision: 1,
    message: edited,
  });
  assert.equal(result.ok && result.value.disposition, "updated");
  assert.equal(result.ok && result.value.conversationRevision, 2);

  const skippedRevision = await repositories.putMessage({
    organizationId: ORGANIZATION_ID,
    expectedConversationRevision: 2,
    message: { ...edited, revision: 3, sourceHash: "hash-edit-3" },
  });
  assert.equal(skippedRevision.ok, false);
  if (!skippedRevision.ok) assert.equal(skippedRevision.error.kind, "conflict");
});

test("ingestion event claims reject idempotency-key payload drift", async () => {
  const repositories = new MemoryRepositories();
  const scope = { organizationId: ORGANIZATION_ID };
  await repositories.saveRun(scope, ingestionRun());

  const first = await repositories.claimEvent(scope, "run-1", ingestionEvent());
  assert.equal(first.ok && first.value.disposition, "created");

  const retry = await repositories.claimEvent(scope, "run-1", ingestionEvent());
  assert.equal(retry.ok && retry.value.disposition, "duplicate");

  const drift = await repositories.claimEvent(
    scope,
    "run-1",
    ingestionEvent({ text: "different" }),
  );
  assert.equal(drift.ok, false);
  if (!drift.ok) assert.equal(drift.error.kind, "conflict");
});

test("private object paths are content-addressed and cannot cross organizations", async () => {
  const repositories = new MemoryRepositories();
  const input = {
    organizationId: ORGANIZATION_ID,
    bucket: "audit-audio" as const,
    objectId: "artifact-1",
    fileName: "../../audit.wav",
    mediaType: "audio/wav",
    bytes: new Uint8Array([1, 2, 3, 4]),
  };
  const stored = await repositories.put(input);
  assert.equal(stored.ok && stored.value.disposition, "created");
  if (!stored.ok) return;
  assert.match(stored.value.value.path, new RegExp(`^${ORGANIZATION_ID}/artifact-1/`));
  assert.doesNotMatch(stored.value.value.path, /\.\.\//);

  const retry = await repositories.put(input);
  assert.equal(retry.ok && retry.value.disposition, "duplicate");

  const denied = await repositories.createReadUrl(
    { organizationId: OTHER_ORGANIZATION_ID },
    "audit-audio",
    stored.value.value.path,
  );
  assert.equal(denied.ok, false);
  if (!denied.ok) assert.equal(denied.error.kind, "forbidden");

  const signed = await repositories.createReadUrl(
    { organizationId: ORGANIZATION_ID },
    "audit-audio",
    stored.value.value.path,
  );
  assert.equal(signed.ok, true);
  if (signed.ok) assert.match(signed.value, /^memory:\/\/audit-audio\//);
});
