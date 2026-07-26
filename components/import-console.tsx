"use client";

import Link from "next/link";
import { useState } from "react";

type ImportFormat = "transcript" | "whatsapp_export" | "email" | "generic_json";

export function ImportConsole() {
  const [format, setFormat] = useState<ImportFormat>("transcript");
  const [purpose, setPurpose] = useState<"sales" | "support" | "mixed">("sales");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [agentNames, setAgentNames] = useState("");
  const [status, setStatus] = useState<"idle" | "submitting" | "done" | "error">(
    "idle",
  );
  const [message, setMessage] = useState("");
  const [conversationId, setConversationId] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setStatus("submitting");
    setMessage("Normalizing channel events and preserving evidence…");
    setConversationId(null);
    try {
      const response = await fetch("/api/ingestion/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          format,
          purpose,
          title: title.trim() || undefined,
          content,
          agentNames: agentNames
            .split(",")
            .map((value) => value.trim())
            .filter(Boolean),
        }),
      });
      const payload = (await response.json()) as {
        conversationId?: string;
        eventCount?: number;
        issueCount?: number;
        duplicateCount?: number;
        error?: { message?: string };
      };
      if (!response.ok || !payload.conversationId) {
        throw new Error(payload.error?.message ?? "Import failed");
      }
      setConversationId(payload.conversationId);
      setStatus("done");
      setMessage(
        `${payload.eventCount ?? 0} events accepted · ${payload.duplicateCount ?? 0} duplicates · ${payload.issueCount ?? 0} review issue(s)`,
      );
    } catch (cause) {
      setStatus("error");
      setMessage(cause instanceof Error ? cause.message : "Import failed");
    }
  }

  async function loadFile(file: File | undefined) {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      setStatus("error");
      setMessage("Text and JSON imports are limited to 5 MB.");
      return;
    }
    setContent(await file.text());
    if (!title) setTitle(file.name);
  }

  return (
    <form onSubmit={submit} className="grid gap-5 lg:grid-cols-[320px_minmax(0,1fr)]">
      <aside className="panel space-y-4 p-5">
        <Field label="Source format">
          <select
            value={format}
            onChange={(event) => setFormat(event.target.value as ImportFormat)}
            className="min-h-11 w-full border border-[rgba(239,232,218,0.18)] bg-ink px-3 text-sm text-bone"
          >
            <option value="transcript">Pasted / uploaded transcript</option>
            <option value="whatsapp_export">WhatsApp chat export</option>
            <option value="email">Email message</option>
            <option value="generic_json">Generic JSON</option>
          </select>
        </Field>
        <Field label="Conversation purpose">
          <select
            value={purpose}
            onChange={(event) =>
              setPurpose(event.target.value as "sales" | "support" | "mixed")
            }
            className="min-h-11 w-full border border-[rgba(239,232,218,0.18)] bg-ink px-3 text-sm text-bone"
          >
            <option value="sales">Sales compliance</option>
            <option value="support">Support quality</option>
            <option value="mixed">Mixed sales + support</option>
          </select>
        </Field>
        <Field label="Title">
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Customer or ticket subject"
            className="min-h-11 w-full border border-[rgba(239,232,218,0.18)] bg-ink px-3 text-sm text-bone"
          />
        </Field>
        <Field label="Confirmed agent names">
          <input
            value={agentNames}
            onChange={(event) => setAgentNames(event.target.value)}
            placeholder="Meera, support@bank.in"
            className="min-h-11 w-full border border-[rgba(239,232,218,0.18)] bg-ink px-3 text-sm text-bone"
          />
          <p className="mt-1.5 font-mono text-[11px] leading-relaxed text-dim">
            Comma-separated. Unmapped senders stay unknown and cannot create agent
            violations.
          </p>
        </Field>
        <Field label="Upload text / JSON">
          <input
            type="file"
            accept=".txt,.json,.csv,.log,text/plain,application/json"
            onChange={(event) => void loadFile(event.target.files?.[0])}
            className="block w-full font-mono text-xs text-dim file:mr-3 file:border-0 file:bg-sf file:px-3 file:py-2 file:font-mark file:text-[10px] file:tracking-[0.12em] file:text-ink"
          />
        </Field>
      </aside>

      <section className="panel p-5">
        <label
          htmlFor="import-content"
          className="font-mark text-[10px] tracking-[0.16em] text-sf"
        >
          ORIGINAL CHANNEL CONTENT
        </label>
        <textarea
          id="import-content"
          required
          value={content}
          onChange={(event) => setContent(event.target.value)}
          placeholder={placeholderFor(format)}
          className="scrollbar-thin mt-3 min-h-[420px] w-full resize-y border border-[rgba(239,232,218,0.18)] bg-ink p-4 font-mono text-sm leading-relaxed text-bone"
        />
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={status === "submitting" || content.trim().length === 0}
            className="min-h-12 bg-cy px-6 font-mark text-[11px] tracking-[0.16em] text-ink"
          >
            {status === "submitting" ? "IMPORTING…" : "IMPORT AND AUDIT"}
          </button>
          <p
            className={[
              "font-mono text-[12px]",
              status === "error" ? "text-red" : "text-dim",
            ].join(" ")}
            role={status === "error" ? "alert" : "status"}
          >
            {message || "Raw evidence remains immutable; analysis is replayable."}
          </p>
          {conversationId && (
            <Link
              href={`/conversations/${encodeURIComponent(conversationId)}`}
              className="ml-auto inline-flex min-h-11 items-center border border-[rgba(239,232,218,0.28)] px-4 font-mono text-[11px] uppercase tracking-[0.12em] text-bone"
            >
              Review conversation →
            </Link>
          )}
        </div>
      </section>
    </form>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-2 block font-mono text-[10px] uppercase tracking-[0.15em] text-dim">
        {label}
      </span>
      {children}
    </label>
  );
}

function placeholderFor(format: ImportFormat): string {
  if (format === "whatsapp_export") {
    return "26/07/2026, 10:31 - Meera: Ma'am, return guaranteed hai…";
  }
  if (format === "email") {
    return "From: agent@bank.in\nTo: customer@example.com\nSubject: Policy details\n\nYour returns are guaranteed…";
  }
  if (format === "generic_json") {
    return '[{"id":"m-1","sender":"agent","direction":"outbound","text":"Guaranteed return hai","timestamp":"2026-07-26T10:31:00Z"}]';
  }
  return "Agent: This plan guarantees twelve percent return.\nCustomer: Can I withdraw anytime?\nAgent: Yes, there is no lock-in.";
}
