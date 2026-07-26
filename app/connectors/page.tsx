import Link from "next/link";

import { AppShell } from "@/components/app-shell";

const connectors = [
  {
    name: "WhatsApp Cloud",
    channel: "whatsapp",
    description:
      "Receive message webhooks, edits, deletes, delivery state, and media references.",
    endpoint: "/api/ingestion/webhooks/whatsapp",
    capabilities: ["Incremental", "Edits", "Deletes", "Attachments"],
  },
  {
    name: "Inbound email",
    channel: "email",
    description:
      "Normalize agent and customer email into a threaded support or sales conversation.",
    endpoint: "/api/ingestion/import",
    capabilities: ["Threads", "HTML-safe text", "Attachments"],
  },
  {
    name: "Generic webhook",
    channel: "api",
    description:
      "Post deterministic conversation and message events from any CRM or ticket system.",
    endpoint: "/api/ingestion/webhooks/generic",
    capabilities: ["Idempotency", "Revisions", "Out-of-order events"],
  },
];

export default function ConnectorsPage() {
  return (
    <AppShell>
      <div className="space-y-7">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-saffron">
              Organization sources
            </p>
            <h1 className="font-display mt-1 text-3xl font-semibold tracking-tight sm:text-4xl">
              Connect every customer channel
            </h1>
            <p className="mt-2 max-w-3xl text-sm text-[var(--text-muted)]">
              Adapters normalize channel evidence. They never run models or send
              customer replies, so imports are deterministic and replayable.
            </p>
          </div>
          <Link
            href="/import"
            className="inline-flex min-h-11 items-center rounded-xl bg-saffron px-4 text-sm font-bold text-ink"
          >
            Manual import
          </Link>
        </header>

        <div className="grid gap-4 lg:grid-cols-3">
          {connectors.map((connector) => (
            <article
              key={connector.name}
              className="rounded-2xl border hairline bg-ink-soft/55 p-5"
            >
              <div className="flex items-center justify-between gap-3">
                <h2 className="font-display text-xl font-semibold">{connector.name}</h2>
                <span className="rounded-md bg-saffron/15 px-2 py-1 text-[10px] font-bold uppercase tracking-[0.13em] text-saffron">
                  {connector.channel}
                </span>
              </div>
              <p className="mt-3 min-h-16 text-sm leading-relaxed text-[var(--text-muted)]">
                {connector.description}
              </p>
              <code className="mt-4 block overflow-x-auto rounded-lg bg-ink p-3 text-xs text-safe">
                {connector.endpoint}
              </code>
              <div className="mt-4 flex flex-wrap gap-1.5">
                {connector.capabilities.map((capability) => (
                  <span
                    key={capability}
                    className="rounded bg-ink px-2 py-1 text-[10px] text-[var(--text-muted)]"
                  >
                    {capability}
                  </span>
                ))}
              </div>
              <div className="mt-5 flex items-center gap-2 text-xs font-semibold text-[var(--text-muted)]">
                <span className="size-2 rounded-full bg-saffron" />
                Ready for credentials
              </div>
            </article>
          ))}
        </div>

        <section className="rounded-2xl border hairline bg-ink-soft/40 p-5">
          <h2 className="font-display text-xl font-semibold">Adapter contract</h2>
          <div className="mt-4 grid gap-3 text-sm sm:grid-cols-4">
            <Step number="01" text="Verify webhook or file" />
            <Step number="02" text="Normalize immutable events" />
            <Step number="03" text="Claim idempotency keys" />
            <Step number="04" text="Run versioned policy packs" />
          </div>
        </section>
      </div>
    </AppShell>
  );
}

function Step({ number, text }: { number: string; text: string }) {
  return (
    <div className="rounded-xl bg-ink/55 p-4">
      <span className="font-display text-lg font-semibold text-saffron">{number}</span>
      <p className="mt-2 text-[var(--text-muted)]">{text}</p>
    </div>
  );
}
