import { AppShell } from "@/components/app-shell";
import { getDomain } from "@/lib/domains/registry";
import { store } from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function ProductPage() {
  const products = await store.listProducts();
  const product = products[0];
  if (!product) {
    return (
      <AppShell>
        <div className="mx-auto max-w-2xl py-20">
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-saffron">
            Knowledge sources
          </p>
          <h1 className="font-display mt-2 text-4xl font-semibold tracking-tight">
            No approved product source
          </h1>
          <p className="mt-4 max-w-xl text-[var(--text-muted)]">
            Import an official product document before auditing a production
            conversation. Demo fixtures are now isolated from this route.
          </p>
        </div>
      </AppShell>
    );
  }
  const domain = getDomain(product.domain);

  return (
    <AppShell>
      <div className="space-y-8">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-saffron">
            Product ingest
          </p>
          <h1 className="font-display mt-1 text-3xl font-semibold tracking-tight sm:text-4xl">
            {product.name}
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-[var(--text-muted)]">
            Reviewed terms and conversation-level obligations extracted from
            the approved source document.
          </p>
        </div>

        <section className="rounded-2xl border hairline bg-ink-soft/60 p-5">
          <h2 className="font-display text-xl font-semibold">Extracted terms</h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {domain.termsFields.map((field) => {
              const value = readPath(product.terms as Record<string, unknown>, field.key);
              return (
                <div key={field.key} className="rounded-xl bg-ink/50 px-4 py-3">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">
                    {field.label}
                  </p>
                  <p className="mt-2 text-sm font-medium">
                    {formatValue(value)}
                  </p>
                </div>
              );
            })}
          </div>
        </section>

        <section className="rounded-2xl border hairline bg-ink-soft/60 p-5">
          <h2 className="font-display text-xl font-semibold">Required disclosures</h2>
          <p className="mt-1 text-sm text-[var(--text-muted)]">
            Conversation-level checklist for Check B (omission).
          </p>
          <ul className="mt-4 space-y-3">
            {product.requiredDisclosures.map((d) => (
              <li key={d.id} className="rounded-xl bg-ink/50 px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-md bg-saffron/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] text-saffron">
                    {d.id}
                  </span>
                  {d.critical && (
                    <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-signal">
                      critical
                    </span>
                  )}
                </div>
                <p className="mt-2 text-sm font-medium">{d.text}</p>
                <p className="mt-1 text-xs text-[var(--text-muted)]">{d.whyRequired}</p>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </AppShell>
  );
}

function readPath(obj: Record<string, unknown>, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc && typeof acc === "object") return (acc as Record<string, unknown>)[key];
    return undefined;
  }, obj);
}

function formatValue(value: unknown): string {
  if (value === undefined || value === null || value === "") return "—";
  if (Array.isArray(value)) return value.join("; ");
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}
