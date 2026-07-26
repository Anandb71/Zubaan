import Link from "next/link";

import { AppShell } from "@/components/app-shell";
import { languageLabel } from "@/lib/i18n/languages";
import { store } from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function AuditPage({ params }: { params: { id: string } }) {
  const audit = await store.getAudit(params.id);

  if (!audit) {
    return (
      <AppShell>
        <div className="mx-auto max-w-lg py-16 text-center">
          <h1 className="font-display text-3xl font-semibold">Audit not found</h1>
          <p className="mt-3 text-[var(--text-muted)]">
            Run a call and end it to generate the customer voice note.
          </p>
          <Link href="/call" className="mt-6 inline-flex min-h-11 items-center rounded-xl bg-saffron px-5 font-bold text-ink">
            Go to live call
          </Link>
        </div>
      </AppShell>
    );
  }

  const call = await store.getCall(audit.callId);

  return (
    <div className="paper-surface min-h-dvh">
      <div className="mx-auto max-w-lg px-4 py-8 sm:px-6">
        <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-[oklch(0.45_0.05_238)]">
          Customer audit · {languageLabel(audit.summaryLang)}
        </p>
        <h1 className="font-display mt-2 text-4xl font-semibold tracking-tight text-[oklch(0.2_0.02_238)]">
          Before you sign
        </h1>
        <p className="mt-3 text-base leading-relaxed text-[oklch(0.35_0.02_238)]">
          {call
            ? `${call.customerName}, here is what was promised versus what the document says.`
            : "Here is what was promised versus what the document says."}
        </p>

        {audit.audioUrl ? (
          <div className="mt-8 rounded-2xl bg-[oklch(0.2_0.02_238)] p-5 text-[oklch(0.95_0.01_82)]">
            <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-saffron">
              Play voice note
            </p>
            <audio className="mt-4 w-full" controls src={audit.audioUrl} preload="metadata">
              Your browser does not support audio.
            </audio>
            {audit.degraded && (
              <p className="mt-3 text-xs text-[oklch(0.75_0.02_82)]">
                Voice may be text-only if TTS was unavailable — the facts below still stand.
              </p>
            )}
          </div>
        ) : (
          <div className="mt-8 rounded-2xl border border-[oklch(0.8_0.02_82)] bg-white p-5">
            <p className="text-sm font-semibold text-[oklch(0.25_0.02_238)]">{audit.summaryText}</p>
          </div>
        )}

        <div className="mt-8 space-y-4">
          <AuditCard title="Promised" items={audit.promised} tone="warn" />
          <AuditCard title="Actual" items={audit.actual} tone="ok" />
          <AuditCard title="Gap" items={audit.gaps} tone="gap" />
        </div>

        <p className="mt-10 text-sm leading-relaxed text-[oklch(0.4_0.02_238)]">
          {audit.summaryText}
        </p>

        <Link
          href="/call"
          className="mt-8 inline-flex min-h-11 items-center text-sm font-semibold text-[oklch(0.3_0.04_238)] underline-offset-4 hover:underline"
        >
          Back to agent console
        </Link>
      </div>
    </div>
  );
}

function AuditCard({
  title,
  items,
  tone,
}: {
  title: string;
  items: string[];
  tone: "warn" | "ok" | "gap";
}) {
  const bg =
    tone === "warn"
      ? "bg-[oklch(0.93_0.04_75)]"
      : tone === "ok"
        ? "bg-[oklch(0.93_0.03_150)]"
        : "bg-[oklch(0.93_0.04_25)]";

  return (
    <section className={`rounded-2xl ${bg} p-5`}>
      <h2 className="font-display text-2xl font-semibold text-[oklch(0.2_0.02_238)]">{title}</h2>
      {items.length === 0 ? (
        <p className="mt-3 text-sm text-[oklch(0.4_0.02_238)]">Nothing listed.</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {items.map((item) => (
            <li key={item} className="text-base leading-relaxed text-[oklch(0.25_0.02_238)]">
              {item}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
