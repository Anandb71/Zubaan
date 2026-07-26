import Link from "next/link";

import { AppShell } from "@/components/app-shell";
import { ImportConsole } from "@/components/import-console";

export default function ImportPage() {
  return (
    <AppShell>
      <div className="space-y-6">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="font-mark text-[11px] tracking-[0.2em] text-sf">
              04 — CHANNEL INGESTION
            </p>
            <h1 className="font-display mt-2 text-[clamp(28px,4vw,48px)] font-bold leading-[0.95] tracking-[-0.03em]">
              Import any conversation
            </h1>
            <p className="mt-3 max-w-3xl text-sm text-dim">
              Bring WhatsApp exports, email, support tickets, generic JSON, or
              pasted transcripts into the same evidence-backed audit model.
            </p>
          </div>
          <Link
            href="/connectors"
            className="inline-flex min-h-11 items-center border border-[rgba(239,232,218,0.28)] px-4 font-mono text-[11px] uppercase tracking-[0.14em] text-bone"
          >
            Connector setup
          </Link>
        </header>
        <ImportConsole />
      </div>
    </AppShell>
  );
}
