import { createHash } from "node:crypto";

import { NextResponse } from "next/server";
import { z } from "zod";

import { DEMO_PRODUCT } from "@/dev/fixtures/zubaan-demo";
import type { AuditRun, EvidenceRef, Finding } from "@/lib/compliance/types";
import { config } from "@/lib/config";
import {
  isAuditableAgentMessage,
  type Conversation,
  type Message,
  type Participant,
} from "@/lib/conversations/types";
import {
  checkContradiction,
  diffOmissions,
  matchDisclosures,
} from "@/lib/engine/heuristics";
import { requireSameOrigin } from "@/lib/http/request-security";
import type { IngestionEvent, IngestionRun } from "@/lib/ingestion/types";
import { httpStatusFor, toClientError } from "@/lib/kernel";
import { repositories } from "@/lib/repositories";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const inputSchema = z.object({
  format: z.enum(["transcript", "whatsapp_export", "email", "generic_json"]),
  purpose: z.enum(["sales", "support", "mixed"]),
  title: z.string().trim().min(1).max(200).optional(),
  content: z.string().min(1).max(5_000_000),
  agentNames: z.array(z.string().trim().min(1).max(200)).max(50).default([]),
});

interface ParsedLine {
  sender: string;
  text: string;
  occurredAt?: string;
  externalId?: string;
  explicitRole?: Participant["role"];
}

export async function POST(request: Request) {
  const origin = requireSameOrigin(request);
  if (!origin.ok) return errorResponse(origin.error);
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (declaredLength > 5_250_000) {
    return NextResponse.json(
      { error: { kind: "validation", message: "Import payload is too large" } },
      { status: 413 },
    );
  }
  const parsedInput = inputSchema.safeParse(await request.json().catch(() => null));
  if (!parsedInput.success) {
    return NextResponse.json(
      { error: { kind: "validation", message: "Invalid import payload" } },
      { status: 400 },
    );
  }

  const input = parsedInput.data;
  const organizationId = config.workspace.organizationId;
  const rawHash = hash(
    JSON.stringify({
      format: input.format,
      purpose: input.purpose,
      content: input.content,
      agentNames: [...input.agentNames].sort(),
    }),
  );
  const conversationId = `conv-${rawHash.slice(0, 32)}`;
  const scope = { organizationId };
  const existing = await repositories.conversations.getConversation(
    scope,
    conversationId,
  );
  if (!existing.ok) return errorResponse(existing.error);
  if (existing.value) {
    return NextResponse.json({
      conversationId,
      eventCount: existing.value.revision + 1,
      issueCount: 0,
      duplicateCount: 1,
    });
  }

  const now = new Date().toISOString();
  const lines = parseLines(input.format, input.content);
  if (lines.length === 0) {
    return NextResponse.json(
      { error: { kind: "validation", message: "No messages found in import" } },
      { status: 400 },
    );
  }
  const channel = channelFor(input.format);
  const participants = buildParticipants(
    conversationId,
    lines,
    input.agentNames,
    now,
  );
  const participantBySender = new Map(
    participants.map((participant) => [
      String(participant.metadata.senderKey),
      participant,
    ]),
  );
  const messages = buildMessages(conversationId, lines, participantBySender, now);
  const issueCount = participants.filter(
    (participant) => participant.role === "unknown",
  ).length;
  const conversation: Conversation = {
    id: conversationId,
    organizationId,
    channel,
    ingestionMode: input.format === "whatsapp_export" ? "export" : "paste",
    purpose: input.purpose,
    lifecycle: "closed",
    processingState: issueCount > 0 ? "needs_review" : "queued",
    policyPackIds: [
      input.purpose === "support" ? "default-support-v1" : "default-sales-v1",
    ],
    externalThreadKey: `${input.format}:${rawHash}`,
    title: input.title ?? defaultTitle(input.format, lines),
    startedAt: lines[0]?.occurredAt ?? now,
    lastActivityAt: lines.at(-1)?.occurredAt ?? now,
    closedAt: lines.at(-1)?.occurredAt ?? now,
    revision: 0,
    metadata: { rawHash, importFormat: input.format },
    createdAt: now,
    updatedAt: now,
  };
  const run: IngestionRun = {
    id: `run-${rawHash.slice(0, 32)}`,
    organizationId,
    adapterId: input.format,
    adapterVersion: "1.0.0",
    channel,
    ingestionMode: conversation.ingestionMode,
    purpose: input.purpose,
    status: "processing",
    rawContentHash: rawHash,
    eventCount: 0,
    issueCount,
    createdAt: now,
  };

  const savedRun = await repositories.ingestion.saveRun(scope, run);
  if (!savedRun.ok) return errorResponse(savedRun.error);
  const savedConversation = await repositories.conversations.createConversation(
    scope,
    conversation,
  );
  if (!savedConversation.ok) return errorResponse(savedConversation.error);

  let eventCount = 0;
  let duplicateCount = 0;
  const opened = eventFor(
    run,
    "conversation.opened",
    `${rawHash}:conversation`,
    { conversation },
    now,
  );
  const openedClaim = await repositories.ingestion.claimEvent(scope, run.id, opened);
  if (!openedClaim.ok) return errorResponse(openedClaim.error);
  eventCount += 1;
  if (openedClaim.value.disposition === "duplicate") duplicateCount += 1;

  for (const participant of participants) {
    const saved = await repositories.conversations.upsertParticipant(
      scope,
      participant,
    );
    if (!saved.ok) return errorResponse(saved.error);
    const event = eventFor(
      run,
      "participant.upserted",
      `${rawHash}:participant:${participant.id}`,
      { participant },
      now,
    );
    const claimed = await repositories.ingestion.claimEvent(scope, run.id, event);
    if (!claimed.ok) return errorResponse(claimed.error);
    eventCount += 1;
    if (claimed.value.disposition === "duplicate") duplicateCount += 1;
  }

  let revision = savedConversation.value.value.revision;
  for (const message of messages) {
    const saved = await repositories.conversations.putMessage({
      organizationId,
      expectedConversationRevision: revision,
      message,
    });
    if (!saved.ok) return errorResponse(saved.error);
    revision = saved.value.conversationRevision;
    const event = eventFor(
      run,
      "message.upserted",
      `${rawHash}:message:${message.id}:${message.revision}`,
      { message },
      now,
    );
    const claimed = await repositories.ingestion.claimEvent(scope, run.id, event);
    if (!claimed.ok) return errorResponse(claimed.error);
    eventCount += 1;
    if (claimed.value.disposition === "duplicate") duplicateCount += 1;
  }

  const findingCount = await runFastPolicy(
    conversation,
    participants,
    messages,
    revision,
    now,
  );
  await repositories.ingestion.saveRun(scope, {
    ...run,
    status: issueCount > 0 ? "partial" : "completed",
    eventCount,
    completedAt: new Date().toISOString(),
  });
  return NextResponse.json(
    { conversationId, eventCount, issueCount, duplicateCount, findingCount },
    { status: 201 },
  );
}

async function runFastPolicy(
  conversation: Conversation,
  participants: Participant[],
  messages: Message[],
  revision: number,
  now: string,
): Promise<number> {
  const scope = { organizationId: conversation.organizationId };
  const policyPackId =
    conversation.purpose === "support" ? "default-support-v1" : "default-sales-v1";
  const auditRun: AuditRun = {
    id: `audit-run-${hash(`${conversation.id}:${revision}:${policyPackId}`).slice(0, 28)}`,
    organizationId: conversation.organizationId,
    conversationId: conversation.id,
    conversationRevision: revision,
    policyPackId,
    policyPackVersion: 1,
    knowledgeSnapshot:
      conversation.purpose === "support" ? { support_playbook: 1 } : { product_terms: 1 },
    trigger: "conversation_finalized",
    status: "completed",
    startedAt: now,
    completedAt: now,
    degradedReasons: [],
    metrics: { messageCount: messages.length },
    createdAt: now,
  };
  const savedRun = await repositories.compliance.saveAuditRun(scope, auditRun);
  if (!savedRun.ok) return 0;

  const participantById = new Map(participants.map((item) => [item.id, item]));
  const auditable = messages.filter((message) =>
    isAuditableAgentMessage(
      message,
      message.participantId
        ? participantById.get(message.participantId)
        : undefined,
    ),
  );
  const findings: Array<{ finding: Finding; evidence: EvidenceRef[] }> = [];

  if (conversation.purpose !== "support") {
    for (const message of auditable) {
      const result = checkContradiction(message.originalText, DEMO_PRODUCT.terms);
      if (result.supported || !result.isClaim) continue;
      const fingerprint = hash(
        `${auditRun.id}:${result.ruleId}:${message.id}:${result.claimMade}`,
      );
      findings.push({
        finding: {
          id: `finding-${fingerprint.slice(0, 28)}`,
          organizationId: conversation.organizationId,
          conversationId: conversation.id,
          auditRunId: auditRun.id,
          checkDefinitionId: `sales:${result.ruleId ?? "unsupported_claim"}`,
          fingerprint,
          kind: "contradiction",
          outcome: "fail",
          lifecycle: "open",
          severity: result.severity === "high" ? "high" : "low",
          title: "Unsupported product promise",
          explanation: result.contradictedBy,
          coachSuggestion: result.suggestedCorrection,
          implicatedMessageIds: [message.id],
          confidence: 0.95,
          source: "rule",
          createdAt: now,
          updatedAt: now,
        },
        evidence: [
          evidenceFor(fingerprint, message.id, "trigger_message", message.originalText, now),
          evidenceFor(
            `${fingerprint}:policy`,
            undefined,
            "policy_rule",
            result.contradictedBy,
            now,
          ),
        ],
      });
    }

    const satisfied = new Set(
      auditable.flatMap((message) =>
        matchDisclosures(message.originalText, DEMO_PRODUCT.requiredDisclosures),
      ),
    );
    for (const disclosure of diffOmissions(
      satisfied,
      DEMO_PRODUCT.requiredDisclosures,
    )) {
      const fingerprint = hash(`${auditRun.id}:omission:${disclosure.id}`);
      findings.push({
        finding: {
          id: `finding-${fingerprint.slice(0, 28)}`,
          organizationId: conversation.organizationId,
          conversationId: conversation.id,
          auditRunId: auditRun.id,
          checkDefinitionId: `sales:disclosure:${disclosure.id}`,
          fingerprint,
          kind: "omission",
          outcome: "fail",
          lifecycle: "open",
          severity: disclosure.critical ? "high" : "medium",
          title: "Required disclosure omitted",
          explanation: disclosure.whyRequired,
          coachSuggestion: disclosure.text,
          implicatedMessageIds: [],
          confidence: 1,
          source: "rule",
          createdAt: now,
          updatedAt: now,
        },
        evidence: [
          evidenceFor(
            `${fingerprint}:policy`,
            undefined,
            "policy_rule",
            disclosure.text,
            now,
          ),
        ],
      });
    }
  } else {
    for (const message of auditable) {
      if (/\b(otp|pin|password|cvv)\b/i.test(message.originalText)) {
        findings.push(
          supportFinding(
            auditRun,
            conversation,
            message,
            "privacy",
            "Sensitive credential requested",
            "Support agents must never request OTP, PIN, CVV, or passwords.",
            "Ask the customer to enter credentials only in the bank's secure flow.",
            now,
          ),
        );
      }
      if (/\b(guaranteed|definitely|100%)\b.{0,40}\b(resolve|refund|reverse)\b/i.test(message.originalText)) {
        findings.push(
          supportFinding(
            auditRun,
            conversation,
            message,
            "prohibited_commitment",
            "Unsupported resolution commitment",
            "The agent promised an outcome before investigation evidence existed.",
            "Give a documented SLA and next step without guaranteeing the outcome.",
            now,
          ),
        );
      }
    }
    const escalationTrigger = messages.find(
      (message) =>
        !auditable.includes(message) &&
        /\b(fraud|scam|unauthori[sz]ed|stolen)\b/i.test(message.originalText),
    );
    const escalated = auditable.some((message) =>
      /\b(escalat|fraud team|complaint number|case id|senior)\b/i.test(
        message.originalText,
      ),
    );
    if (escalationTrigger && !escalated) {
      const fingerprint = hash(`${auditRun.id}:missing-escalation`);
      findings.push({
        finding: {
          id: `finding-${fingerprint.slice(0, 28)}`,
          organizationId: conversation.organizationId,
          conversationId: conversation.id,
          auditRunId: auditRun.id,
          checkDefinitionId: "support:fraud-escalation",
          fingerprint,
          kind: "escalation",
          outcome: "fail",
          lifecycle: "open",
          severity: "critical",
          title: "Fraud report was not escalated",
          explanation:
            "The customer reported possible fraud, but no escalation or case reference was provided.",
          coachSuggestion:
            "Escalate to the fraud team immediately and give the customer a case reference.",
          implicatedMessageIds: [escalationTrigger.id],
          confidence: 0.95,
          source: "rule",
          createdAt: now,
          updatedAt: now,
        },
        evidence: [
          evidenceFor(
            fingerprint,
            escalationTrigger.id,
            "trigger_message",
            escalationTrigger.originalText,
            now,
          ),
          evidenceFor(
            `${fingerprint}:policy`,
            undefined,
            "policy_rule",
            "Suspected fraud must be escalated immediately with a case reference.",
            now,
          ),
        ],
      });
    }
  }

  let savedCount = 0;
  for (const item of findings) {
    const saved = await repositories.compliance.saveFinding(scope, item.finding);
    if (!saved.ok) continue;
    savedCount += 1;
    for (const evidence of item.evidence) {
      await repositories.compliance.saveEvidence(scope, {
        ...evidence,
        findingId: saved.value.value.id,
      });
    }
  }
  return savedCount;
}

function supportFinding(
  auditRun: AuditRun,
  conversation: Conversation,
  message: Message,
  kind: "privacy" | "prohibited_commitment",
  title: string,
  explanation: string,
  coachSuggestion: string,
  now: string,
): { finding: Finding; evidence: EvidenceRef[] } {
  const fingerprint = hash(`${auditRun.id}:${kind}:${message.id}`);
  return {
    finding: {
      id: `finding-${fingerprint.slice(0, 28)}`,
      organizationId: conversation.organizationId,
      conversationId: conversation.id,
      auditRunId: auditRun.id,
      checkDefinitionId: `support:${kind}`,
      fingerprint,
      kind,
      outcome: "fail",
      lifecycle: "open",
      severity: "high",
      title,
      explanation,
      coachSuggestion,
      implicatedMessageIds: [message.id],
      confidence: 0.95,
      source: "rule",
      createdAt: now,
      updatedAt: now,
    },
    evidence: [
      evidenceFor(fingerprint, message.id, "trigger_message", message.originalText, now),
      evidenceFor(`${fingerprint}:policy`, undefined, "policy_rule", explanation, now),
    ],
  };
}

function evidenceFor(
  key: string,
  messageId: string | undefined,
  evidenceType: EvidenceRef["evidenceType"],
  quote: string,
  now: string,
): EvidenceRef {
  return {
    id: `evidence-${hash(key).slice(0, 28)}`,
    findingId: "pending",
    evidenceType,
    messageId,
    quote,
    metadata: {},
    createdAt: now,
  };
}

function parseLines(
  format: z.infer<typeof inputSchema>["format"],
  content: string,
): ParsedLine[] {
  if (format === "generic_json") return parseJson(content);
  if (format === "email") return parseEmail(content);
  if (format === "whatsapp_export") return parseWhatsApp(content);
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      const match = line.match(/^([^:]{1,120}):\s*(.+)$/);
      const sender = match?.[1]?.trim() ?? "Unknown";
      return {
        sender,
        text: match?.[2]?.trim() ?? line,
        externalId: `line-${index}`,
        explicitRole: roleFromLabel(sender),
      };
    });
}

function parseWhatsApp(content: string): ParsedLine[] {
  const output: ParsedLine[] = [];
  const pattern =
    /^\[?(\d{1,2}[/-]\d{1,2}[/-]\d{2,4}),?\s+(\d{1,2}:\d{2}(?:\s?[AP]M)?)\]?\s+-\s+([^:]+):\s?(.*)$/i;
  for (const rawLine of content.split(/\r?\n/)) {
    const match = rawLine.match(pattern);
    if (match) {
      output.push({
        sender: match[3]!.trim(),
        text: match[4]!.trim(),
        occurredAt: parseWhatsAppDate(match[1]!, match[2]!),
        externalId: `wa-${output.length}`,
      });
    } else if (output.length > 0 && rawLine.trim()) {
      output[output.length - 1]!.text += `\n${rawLine.trim()}`;
    }
  }
  return output;
}

function parseEmail(content: string): ParsedLine[] {
  const [headerBlock = "", ...bodyParts] = content.split(/\r?\n\r?\n/);
  const headers = Object.fromEntries(
    headerBlock
      .split(/\r?\n/)
      .map((line) => line.match(/^([^:]+):\s*(.*)$/))
      .filter((match): match is RegExpMatchArray => Boolean(match))
      .map((match) => [match[1]!.toLowerCase(), match[2]!.trim()]),
  );
  const sender = headers.from ?? "Unknown";
  const occurredAt = validIso(headers.date);
  return [
    {
      sender,
      text: bodyParts.join("\n\n").trim() || content.trim(),
      occurredAt,
      externalId: headers["message-id"] ?? "email-0",
    },
  ];
}

function parseJson(content: string): ParsedLine[] {
  try {
    const parsed: unknown = JSON.parse(content);
    const rows = Array.isArray(parsed) ? parsed : [parsed];
    return rows.flatMap((raw, index) => {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
      const row = raw as Record<string, unknown>;
      const text = String(row.text ?? row.body ?? row.message ?? "").trim();
      if (!text) return [];
      const sender = String(row.sender ?? row.from ?? row.role ?? "Unknown");
      return [
        {
          sender,
          text,
          occurredAt: validIso(row.timestamp ?? row.occurredAt),
          externalId: String(row.id ?? row.messageId ?? `json-${index}`),
          explicitRole: roleFromLabel(String(row.role ?? "")),
        },
      ];
    });
  } catch {
    return [];
  }
}

function buildParticipants(
  conversationId: string,
  lines: ParsedLine[],
  agentNames: string[],
  now: string,
): Participant[] {
  const confirmedAgents = new Set(agentNames.map(normalize));
  const senders = [...new Set(lines.map((line) => line.sender))];
  return senders.map((sender) => {
    const explicit = lines.find((line) => line.sender === sender)?.explicitRole;
    const confirmed = confirmedAgents.has(normalize(sender));
    const role = confirmed ? "agent" : explicit ?? "unknown";
    return {
      id: `participant-${hash(`${conversationId}:${sender}`).slice(0, 24)}`,
      conversationId,
      role,
      displayName: sender,
      externalId: sender,
      roleConfidence: confirmed || explicit ? 1 : 0,
      metadata: { senderKey: sender },
      createdAt: now,
      updatedAt: now,
    };
  });
}

function buildMessages(
  conversationId: string,
  lines: ParsedLine[],
  participantBySender: Map<string, Participant>,
  now: string,
): Message[] {
  return lines.map((line, ordinal) => {
    const participant = participantBySender.get(line.sender);
    const occurredAt =
      line.occurredAt ?? new Date(Date.parse(now) + ordinal).toISOString();
    const sourceHash = hash(
      `${conversationId}:${line.externalId}:${line.sender}:${line.text}:${occurredAt}`,
    );
    return {
      id: `message-${sourceHash.slice(0, 32)}`,
      conversationId,
      participantId: participant?.id,
      externalMessageId: line.externalId,
      revision: 0,
      direction: participant?.role === "agent" ? "outbound" : "inbound",
      visibility: "customer_visible",
      state: participant?.role === "agent" ? "sent" : "received",
      modality: "text",
      originalText: line.text,
      normalizedText: line.text.normalize("NFKC").trim().toLowerCase(),
      occurredAt,
      receivedAt: now,
      ordinal,
      sourceHash,
      metadata: {},
      createdAt: now,
      updatedAt: now,
    };
  });
}

function eventFor(
  run: IngestionRun,
  type: IngestionEvent["type"],
  idempotencyKey: string,
  payload: Record<string, unknown>,
  receivedAt: string,
): IngestionEvent {
  return {
    schemaVersion: 1,
    eventId: `event-${hash(idempotencyKey).slice(0, 32)}`,
    adapterId: run.adapterId,
    adapterVersion: run.adapterVersion,
    idempotencyKey,
    receivedAt,
    type,
    payload,
  };
}

function channelFor(
  format: z.infer<typeof inputSchema>["format"],
): Conversation["channel"] {
  if (format === "whatsapp_export") return "whatsapp";
  if (format === "email") return "email";
  return "transcript";
}

function roleFromLabel(value: string): Participant["role"] | undefined {
  const label = normalize(value);
  if (["agent", "advisor", "sales", "support", "representative"].includes(label)) {
    return "agent";
  }
  if (["customer", "client", "user"].includes(label)) return "customer";
  return undefined;
}

function defaultTitle(
  format: z.infer<typeof inputSchema>["format"],
  lines: ParsedLine[],
): string {
  return `${format.replace("_", " ")} · ${lines[0]?.sender ?? "conversation"}`;
}

function parseWhatsAppDate(date: string, time: string): string | undefined {
  const [day, month, rawYear] = date.split(/[/-]/).map(Number);
  if (!day || !month || !rawYear) return undefined;
  const year = rawYear < 100 ? 2000 + rawYear : rawYear;
  const parsed = new Date(`${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")} ${time}`);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

function validIso(value: unknown): string | undefined {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function errorResponse(error: Parameters<typeof toClientError>[0]) {
  return NextResponse.json(toClientError(error), {
    status: httpStatusFor(error),
  });
}
