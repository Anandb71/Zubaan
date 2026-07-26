import Link from "next/link";

import { AppShell } from "@/components/app-shell";

export default function HomePage() {
  return (
    <AppShell bare>
      <section className="relative mx-auto grid min-h-[calc(100dvh-3.5rem)] max-w-[1240px] grid-rows-[1fr_auto] overflow-hidden px-4 pb-8 pt-16 sm:px-6">
        <div
          className="pointer-events-none absolute inset-0 flex items-center justify-center overflow-hidden opacity-[0.055]"
          aria-hidden
        >
          <div className="font-deva text-[min(42vw,620px)] font-bold leading-[0.8] whitespace-nowrap text-bone">
            ज़ुबान
          </div>
        </div>

        <div className="relative z-[1] my-auto grid w-full gap-8">
          <div className="flex flex-wrap items-center gap-2.5 font-mark text-[10px] tracking-[0.18em]">
            <span className="bg-cy px-2.5 py-1.5 text-ink">REAL-TIME</span>
            <span className="border border-[rgba(239,232,218,0.25)] px-2.5 py-1.5 text-dim">
              VERNACULAR
            </span>
            <span className="border border-[rgba(239,232,218,0.25)] px-2.5 py-1.5 text-dim">
              COMPLIANCE WITNESS
            </span>
          </div>

          <h1 className="m-0 text-[min(19vw,180px)] font-extrabold uppercase leading-[0.78] tracking-[-0.05em] sm:text-[min(19vw,220px)]">
            <span className="block">
              Zub<span className="text-sf">aa</span>n
            </span>
          </h1>

          <div className="grid items-end gap-7 md:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
            <p className="m-0 max-w-[58ch] text-pretty text-[clamp(17px,1.6vw,23px)] leading-[1.42] text-bone">
              Every voice AI in India listens to{" "}
              <em className="not-italic text-dim">one human</em> so a machine can
              answer.
              <br />
              Zubaan listens to{" "}
              <strong className="font-bold text-cy">two humans</strong> so neither
              one can lie.
            </p>
            <div className="flex flex-col gap-3 border-l border-[rgba(239,232,218,0.16)] pl-4 font-mono text-[11px] leading-[1.7] text-dim">
              <span>IT HEARS THE SALES PITCH IN हिन्दी, मराठी, தமிழ், বাংলা.</span>
              <span>IT READS THE POLICY DOCUMENT IN ENGLISH.</span>
              <span className="text-red">
                IT FLAGS THE GAP BEFORE THE PEN TOUCHES PAPER.
              </span>
            </div>
          </div>

          <div className="flex flex-wrap gap-3 pt-2">
            <Link
              href="/call"
              className="inline-flex min-h-12 items-center bg-cy px-6 font-mark text-[11px] tracking-[0.16em] text-ink transition-transform hover:brightness-105 active:scale-[0.98]"
            >
              REPLAY THE DEMO
            </Link>
            <Link
              href="/import"
              className="inline-flex min-h-12 items-center border border-[rgba(239,232,218,0.28)] px-6 font-mono text-[11px] uppercase tracking-[0.14em] text-bone transition-colors hover:border-cy hover:text-cy"
            >
              Import a channel
            </Link>
            <Link
              href="/inbox"
              className="inline-flex min-h-12 items-center px-4 font-mono text-[11px] uppercase tracking-[0.14em] text-dim transition-colors hover:text-bone"
            >
              Open inbox →
            </Link>
          </div>
        </div>

        <footer className="relative z-[1] mt-10 flex flex-wrap items-end justify-between gap-4 border-t border-[rgba(239,232,218,0.12)] pt-5 font-mono text-[10px] uppercase tracking-[0.14em] text-dim">
          <p className="m-0 max-w-xl normal-case tracking-normal text-dim">
            Let them speak. We&apos;ll keep the receipt.
          </p>
          <p className="m-0">
            ON-DEVICE ASR · NO AUDIO RETAINED · IRDAI / SEBI ALIGNED
          </p>
        </footer>
      </section>

      <section className="border-t border-[rgba(239,232,218,0.12)] bg-ink-soft px-4 py-16 sm:px-6">
        <div className="mx-auto grid max-w-[1240px] gap-10 md:grid-cols-3">
          <Stat value="340" unit="ms" label="Flag latency" />
          <Stat value="11" unit="" label="Languages" />
          <Stat value="0" unit="" label="Audio stored" />
        </div>
      </section>
    </AppShell>
  );
}

function Stat({
  value,
  unit,
  label,
}: {
  value: string;
  unit: string;
  label: string;
}) {
  return (
    <div>
      <p className="font-mark text-[10px] tracking-[0.2em] text-sf">{label}</p>
      <p className="mt-2 font-display text-5xl font-bold tracking-tight text-bone">
        {value}
        {unit ? (
          <span className="ml-1 font-mono text-base font-normal text-dim">
            {unit}
          </span>
        ) : null}
      </p>
    </div>
  );
}
