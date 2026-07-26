import Link from "next/link";
import { notFound } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { config } from "@/lib/config";
import type { Finding } from "@/lib/compliance/types";
import type { Message, Participant } from "@/lib/conversations/types";
import { repositories } from "@/lib/repositories";

export const dynamic = "force-dynamic";

export default async function ConversationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const scope = { organizationId: config.workspace.organizationId };
  const conversationResult = await repositories.conversations.getConversation(scope, id);
  if (!conversationResult.ok || !conversationResult.value) notFound();
  const conversation = conversationResult.value;

  const [messagesResult, participantsResult, findingsResult] = await Promise.all([
    repositories.conversations.listMessages(scope, id),
    repositories.conversations.listParticipants(scope, id),
    repositories.compliance.listFindings(scope, id),
  ]);
  const messages = messagesResult.ok ? messagesResult.value : [];
  const participants = participantsResult.ok ? participantsResult.value : [];
  const findings = findingsResult.ok ? findingsResult.value : [];
  const participantsById = new Map(participants.map((item) => [item.id, item]));
  const messagesById = new Map(messages.map((item) => [item.id, item]));

  return (
    <AppShell>
      <div className="space-y-6">
        <header>
          <Link
            href="/inbox"
            className="text-xs font-semibold text-[var(--text-muted)] hover:text-saffron"
          >
            ← Conversation inbox
          </Link>
          <div className="mt-4 flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-saffron">
                {conversation.channel.replace("_", " ")} · {conversation.purpose}
              </p>
              <h1 className="font-display mt-1 text-3xl font-semibold tracking-tight">
                {conversation.title ?? "Untitled conversation"}
              </h1>
              <p className="mt-2 text-sm text-[var(--text-muted)]">
                Revision {conversation.revision} · {messages.length} messages ·{" "}
                {findings.length} findings
              </p>
            </div>
            <span
              className={[
                "rounded-md px-3 py-2 text-xs font-bold uppercase tracking-[0.13em]",
                conversation.processingState === "needs_review"
                  ? "bg-signal/20 text-signal"
                  : "bg-safe/15 text-safe",
              ].join(" ")}
            >
              {conversation.processingState.replace("_", " ")}
            </span>
          </div>
        </header>

        <div className="grid gap-5 lg:grid-cols-[minmax(0,1.15fr)_minmax(340px,.85fr)]">
          <section className="rounded-2xl border hairline bg-ink-soft/55">
            <div className="border-b hairline px-5 py-4">
              <h2 className="font-display text-xl font-semibold">Evidence transcript</h2>
              <p className="mt-1 text-xs text-[var(--text-muted)]">
                Original text is preserved. Internal, customer, and uncertain-speaker
                content never becomes an agent violation.
              </p>
            </div>
            <div className="scrollbar-thin max-h-[68vh] space-y-3 overflow-y-auto p-4">
              {messages.length === 0 ? (
                <p className="p-4 text-sm text-[var(--text-muted)]">No messages ingested.</p>
              ) : (
                messages.map((message) => (
                  <MessageCard
                    key={message.id}
                    message={message}
                    participant={
                      message.participantId
                        ? participantsById.get(message.participantId)
                        : undefined
                    }
                    implicated={findings.some((finding) =>
                      finding.implicatedMessageIds.includes(message.id),
                    )}
                  />
                ))
              )}
            </div>
          </section>

          <section className="space-y-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-signal">
                Evidence-backed review
              </p>
              <h2 className="font-display mt-1 text-2xl font-semibold">Findings</h2>
            </div>
            {findings.length === 0 ? (
              <div className="rounded-2xl border hairline bg-ink-soft/50 p-6 text-sm text-[var(--text-muted)]">
                No findings recorded yet. Run the policy pack after ingestion.
              </div>
            ) : (
              findings.map((finding) => (
                <FindingCard
                  key={finding.id}
                  finding={finding}
                  messagesById={messagesById}
                />
              ))
            )}
          </section>
        </div>
      </div>
    </AppShell>
  );
}

function MessageCard({
  message,
  participant,
  implicated,
}: {
  message: Message;
  participant?: Participant;
  implicated: boolean;
}) {
  return (
    <article
      id={`message-${message.id}`}
      className={[
        "rounded-xl border p-3",
        implicated
          ? "border-signal/50 bg-signal/10"
          : "hairline bg-ink/45",
      ].join(" ")}
    >
      <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] font-semibold uppercase tracking-[0.13em] text-[var(--text-muted)]">
        <span>
          {participant?.displayName ?? participant?.role ?? "Unknown speaker"} ·{" "}
          {message.direction}
        </span>
        <span>
          {message.occurredAt
            ? new Date(message.occurredAt).toLocaleString("en-IN", {
                dateStyle: "medium",
                timeStyle: "short",
              })
            : `#${message.ordinal + 1}`}
        </span>
      </div>
      <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed">
        {message.originalText || "—"}
      </p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        <Badge>{message.visibility.replace("_", " ")}</Badge>
        <Badge>{message.state}</Badge>
        {participant && <Badge>{Math.round(participant.roleConfidence * 100)}% role</Badge>}
        {message.language && <Badge>{message.language}</Badge>}
      </div>
    </article>
  );
}

function FindingCard({
  finding,
  messagesById,
}: {
  finding: Finding;
  messagesById: Map<string, Message>;
}) {
  const quotes = finding.implicatedMessageIds
    .map((id) => messagesById.get(id)?.originalText)
    .filter((value): value is string => Boolean(value));
  return (
    <article className="rounded-2xl border border-signal/45 bg-signal/10 p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="rounded-md bg-signal px-2 py-1 text-[10px] font-bold uppercase tracking-[0.13em]">
          {finding.severity} · {finding.kind.replace("_", " ")}
        </span>
        <span className="text-[10px] font-semibold uppercase tracking-[0.13em] text-[var(--text-muted)]">
          {Math.round(finding.confidence * 100)}% · {finding.source}
        </span>
      </div>
      <h3 className="font-display mt-3 text-lg font-semibold">{finding.title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-[var(--text-muted)]">
        {finding.explanation}
      </p>
      {quotes.map((quote) => (
        <blockquote
          key={quote}
          className="mt-3 border-l-2 border-signal pl-3 text-sm italic"
        >
          “{quote}”
        </blockquote>
      ))}
      {finding.coachSuggestion && (
        <div className="mt-3 rounded-lg bg-ink/50 p-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.13em] text-safe">
            Coach instead
          </p>
          <p className="mt-1 text-sm">{finding.coachSuggestion}</p>
        </div>
      )}
    </article>
  );
}

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded bg-ink-soft px-2 py-1 text-[10px] capitalize text-[var(--text-muted)]">
      {children}
    </span>
  );
}
