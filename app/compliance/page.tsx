import { AppShell } from "@/components/app-shell";
import { getComplianceSnapshot } from "@/lib/analytics";

export const dynamic = "force-dynamic";

export default async function CompliancePage() {
  const snap = await getComplianceSnapshot();

  return (
    <AppShell>
      <div className="space-y-8">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-saffron">
            Compliance officer
          </p>
          <h1 className="font-display mt-1 text-3xl font-semibold tracking-tight sm:text-4xl">
            Violation rates
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-[var(--text-muted)]">
            Evidence-backed risk across agents, languages, and reviewed conversations.
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Calls" value={String(snap.totalCalls)} />
          <Stat label="Violations" value={String(snap.totalViolations)} />
          <Stat label="Contradiction" value={String(snap.contradictionCount)} />
          <Stat label="Omission" value={String(snap.omissionCount)} />
        </div>

        <section className="rounded-2xl border hairline bg-ink-soft/60 p-5">
          <h2 className="font-display text-xl font-semibold">Agents by violation rate</h2>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[560px] text-left text-sm">
              <thead className="text-[11px] uppercase tracking-[0.14em] text-[var(--text-muted)]">
                <tr>
                  <th className="pb-3 font-semibold">Agent</th>
                  <th className="pb-3 font-semibold">Branch</th>
                  <th className="pb-3 font-semibold">Calls</th>
                  <th className="pb-3 font-semibold">Rate</th>
                </tr>
              </thead>
              <tbody>
                {snap.agents.map((agent) => (
                  <tr key={agent.id} className="border-t hairline">
                    <td className="py-3 font-medium">{agent.name}</td>
                    <td className="py-3 text-[var(--text-muted)]">{agent.branch}</td>
                    <td className="py-3 tabular">{agent.calls}</td>
                    <td className="py-3 tabular font-semibold text-signal">
                      {agent.violationRate.toFixed(1)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <div className="grid gap-4 lg:grid-cols-2">
          <Panel title="Most common false promise" items={snap.falsePromises} />
          <Panel title="Most skipped disclosure" items={snap.skippedDisclosures} />
        </div>

        <section className="rounded-2xl border hairline bg-ink-soft/40 p-5">
          <h2 className="font-display text-xl font-semibold">By detected language</h2>
          <ul className="mt-4 space-y-2">
            {snap.languages.map((lang) => (
              <li key={lang.key} className="flex items-center justify-between gap-3 text-sm">
                <span>{lang.label}</span>
                <span className="tabular text-[var(--text-muted)]">
                  {lang.count} · {lang.share}%
                </span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </AppShell>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border hairline bg-ink-soft/50 px-4 py-4">
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">
        {label}
      </p>
      <p className="font-display mt-2 text-3xl font-semibold tabular">{value}</p>
    </div>
  );
}

function Panel({
  title,
  items,
}: {
  title: string;
  items: { key: string; label: string; count: number; share: number }[];
}) {
  return (
    <section className="rounded-2xl border hairline bg-ink-soft/60 p-5">
      <h2 className="font-display text-xl font-semibold">{title}</h2>
      <ul className="mt-4 space-y-3">
        {items.slice(0, 6).map((item) => (
          <li key={item.key}>
            <div className="flex items-center justify-between gap-3 text-sm">
              <span className="font-medium">{item.label}</span>
              <span className="tabular text-[var(--text-muted)]">{item.count}</span>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-ink">
              <div
                className="h-full rounded-full bg-saffron"
                style={{ width: `${Math.min(100, Math.max(8, item.share))}%` }}
              />
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
