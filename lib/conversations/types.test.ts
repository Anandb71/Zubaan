import assert from "node:assert/strict";
import { test } from "node:test";

import type { Message, Participant } from "./types";
import { isAuditableAgentMessage } from "./types";

const now = "2026-07-26T08:00:00.000Z";

const agent: Participant = {
  id: "p-agent",
  conversationId: "c-1",
  role: "agent",
  roleConfidence: 1,
  metadata: {},
  createdAt: now,
  updatedAt: now,
};

function message(overrides: Partial<Message> = {}): Message {
  return {
    id: "m-1",
    conversationId: "c-1",
    participantId: agent.id,
    revision: 0,
    direction: "outbound",
    visibility: "customer_visible",
    state: "sent",
    modality: "text",
    originalText: "Returns are guaranteed",
    normalizedText: "returns are guaranteed",
    receivedAt: now,
    ordinal: 0,
    sourceHash: "hash",
    metadata: {},
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

test("sent customer-visible agent messages are auditable", () => {
  assert.equal(isAuditableAgentMessage(message(), agent), true);
});

test("customer, unknown, and low-confidence speakers are never audited as agents", () => {
  assert.equal(
    isAuditableAgentMessage(message(), { ...agent, role: "customer" }),
    false,
  );
  assert.equal(
    isAuditableAgentMessage(message(), { ...agent, role: "unknown" }),
    false,
  );
  assert.equal(
    isAuditableAgentMessage(message(), { ...agent, roleConfidence: 0.79 }),
    false,
  );
});

test("drafts, internal notes, inbound messages, and deleted messages are excluded", () => {
  assert.equal(isAuditableAgentMessage(message({ state: "draft" }), agent), false);
  assert.equal(
    isAuditableAgentMessage(message({ visibility: "internal" }), agent),
    false,
  );
  assert.equal(
    isAuditableAgentMessage(message({ direction: "inbound" }), agent),
    false,
  );
  assert.equal(isAuditableAgentMessage(message({ state: "deleted" }), agent), false);
});
