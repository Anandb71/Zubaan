import Link from "next/link";

import { AppShell } from "@/components/app-shell";
import { config } from "@/lib/config";
import type { Conversation } from "@/lib/conversations/types";
import { repositories } from "@/lib/repositories";

export const dynamic = "force-dynamic";

export default async function InboxPage() {
  const scope = { organizationId: config.workspace.organizationId };
  const listed = await repositories.conversations.listConversations({
    ...scope,
    limit: 100,
  });
  const conversations = listed.ok ? listed.value : [];
  const findingResults = await Promise.all(
    conversations.map((conversation) =>
      repositories.compliance.listFindings(scope, conversation.id),
    ),
  );
  const findingCounts = new Map(
    findingResults.map((result, index) => [
      conversations[index]?.id,
      result.ok
        ? result.value.filter(
            (finding) =>
              finding.outcome === "fail" &&
              finding.lifecycle !== "dismissed" &&
              finding.lifecycle !== "superseded",
          ).length
        : 0,
    ]),
  );

  return (
    <AppShell>
      <div className="space-y-7">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="font-mark text-[11px] tracking-[0.2em] text-sf">
              02 — TWO MOUTHS, ONE LEDGER
            </p>
            <h1 className="font-display mt-2 text-[clamp(28px,4vw,48px)] font-bold leading-[0.95] tracking-[-0.03em]">
              Conversation inbox
            </h1>
            <p className="mt-3 max-w-2xl text-sm text-dim">
              Voice, WhatsApp, email, chat, tickets, and imported transcripts—one
              evidence trail for sales and support.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              href="/import"
              className="inline-flex min-h-11 items-center bg-cy px-4 font-mark text-[11px] tracking-[0.14em] text-ink"
            >
              IMPORT
            </Link>
            <Link
              href="/call"
              className="inline-flex min-h-11 items-center border border-[rgba(239,232,218,0.28)] px-4 font-mono text-[11px] uppercase tracking-[0.14em] text-bone"
            >
              Live call
            </Link>
          </div>
        </header>

        {!listed.ok && (
          <div className="rounded-xl border border-signal/50 bg-signal/10 p-4 text-sm">
            Canonical storage is not ready: {listed.error.message}. Apply the
            Supabase migrations, then refresh.
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-3">
          <Metric label="Conversations" value={conversations.length} />
          <Metric
            label="Needs review"
            value={conversations.filter((item) => item.processingState === "needs_review").length}
          />
          <Metric
            label="Open findings"
            value={[...findingCounts.values()].reduce((sum, count) => sum + (count ?? 0), 0)}
          />
        </div>

        <section className="overflow-hidden rounded-2xl border hairline bg-ink-soft/55">
          <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-4 border-b hairline px-5 py-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--text-muted)] sm:grid-cols-[minmax(0,1fr)_120px_120px_110px]">
            <span>Conversation</span>
            <span className="hidden sm:block">Purpose</span>
            <span className="hidden sm:block">State</span>
            <span>Findings</span>
          </div>
          {conversations.length === 0 ? (
            <EmptyInbox />
          ) : (
            <div className="divide-y divide-[color-mix(in_oklch,var(--line)_55%,transparent)]">
              {conversations.map((conversation) => (
                <ConversationRow
                  key={conversation.id}
                  conversation={conversation}
                  findings={findingCounts.get(conversation.id) ?? 0}
                />
              ))}
            </div>
          )}
        </section>
      </div>
    </AppShell>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl border hairline bg-ink-soft/55 p-4">
      <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-[var(--text-muted)]">
        {label}
      </p>
      <p className="font-display mt-2 text-3xl font-semibold tabular">{value}</p>
    </div>
  );
}

function ConversationRow({
  conversation,
  findings,
}: {
  conversation: Conversation;
  findings: number;
}) {
  return (
    <Link
      href={`/conversations/${encodeURIComponent(conversation.id)}`}
      className="grid min-h-20 grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-5 py-3 transition-colors hover:bg-ink-soft sm:grid-cols-[minmax(0,1fr)_120px_120px_110px]"
    >
      <span className="min-w-0">
        <span className="block truncate text-sm font-semibold">
          {conversation.title ?? "Untitled conversation"}
        </span>
        <span className="mt-1 block truncate text-xs text-[var(--text-muted)]">
          {channelLabel(conversation.channel)} ·{" "}
          {new Date(conversation.lastActivityAt).toLocaleString("en-IN", {
            dateStyle: "medium",
            timeStyle: "short",
          })}
        </span>
      </span>
      <span className="hidden text-xs font-semibold capitalize sm:block">
        {conversation.purpose}
      </span>
      <span className="hidden text-xs capitalize text-[var(--text-muted)] sm:block">
        {conversation.processingState.replace("_", " ")}
      </span>
      <span
        className={[
          "justify-self-end rounded-md px-2.5 py-1 text-xs font-bold tabular",
          findings > 0 ? "bg-signal/20 text-signal" : "bg-safe/15 text-safe",
        ].join(" ")}
      >
        {findings > 0 ? `${findings} open` : "Clear"}
      </span>
    </Link>
  );
}

function EmptyInbox() {
  return (
    <div className="px-6 py-14 text-center">
      <p className="font-display text-xl font-semibold">No conversations yet</p>
      <p className="mx-auto mt-2 max-w-md text-sm text-[var(--text-muted)]">
        Paste a transcript, import a WhatsApp export, post generic JSON, or start
        a live call. Every channel lands in this same review queue.
      </p>
      <Link
        href="/import"
        className="mt-5 inline-flex min-h-11 items-center rounded-xl bg-saffron px-4 text-sm font-bold text-ink"
      >
        Import the first conversation
      </Link>
    </div>
  );
}

function channelLabel(channel: Conversation["channel"]): string {
  return {
    live_voice: "Live voice",
    email: "Email",
    whatsapp: "WhatsApp",
    sms: "SMS",
    web_chat: "Web chat",
    ticket: "Support ticket",
    in_person: "In person",
    transcript: "Transcript",
    unknown: "Unknown channel",
  }[channel];
}
