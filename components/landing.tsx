"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type Scenario = {
  lang: string;
  font: string;
  native: string;
  gloss: string;
  docRef: string;
  clause: string;
  ok: boolean;
  label: string;
  note: string;
};

type FeedRow = {
  time: string;
  spk: string;
  spkColor: string;
  font: string;
  native: string;
  en: string;
  flagged: boolean;
  flag: string;
};

type Alert = { color: string; title: string; body: string };

const SCENARIOS: Scenario[] = [
  {
    lang: "HINDI",
    font: "var(--font-deva), 'Noto Sans Devanagari', serif",
    native:
      "सर, ये पॉलिसी हर साल गारंटीड बारह परसेंट रिटर्न देती है — बैंक एफडी से डबल।",
    gloss:
      "Sir, this policy gives a guaranteed twelve percent return every year — double a bank FD.",
    docRef: "ULIP-2026-A · CLAUSE 4.2 · RETURNS",
    clause:
      "Returns under this plan are market-linked. No rate of return is guaranteed at any point of the policy term.",
    ok: false,
    label: "MISMATCH · SEVERITY 3",
    note: "Guaranteed-return language on a market-linked product. IRDAI Ref. Cir. 2010/ULIP — flagged 340ms after utterance.",
  },
  {
    lang: "MARATHI",
    font: "var(--font-deva), 'Noto Sans Devanagari', serif",
    native:
      "पहिल्याच वर्षी पाहिजे तेव्हा पैसे काढू शकता, काहीही चार्ज लागत नाही.",
    gloss:
      "You can withdraw the money any time in the very first year, there is no charge at all.",
    docRef: "ULIP-2026-A · CLAUSE 9.1 · SURRENDER",
    clause:
      "Surrender within the first five policy years attracts a discontinuance charge and funds move to the DPF.",
    ok: false,
    label: "MISMATCH · SEVERITY 4",
    note: "Liquidity misrepresented. Lock-in of 5 years omitted from the spoken pitch entirely.",
  },
  {
    lang: "TAMIL",
    font: "var(--font-tamil), 'Noto Sans Tamil', sans-serif",
    native: "இந்தக் கடனுக்கான வட்டி விகிதம் நிலையானது, மாறவே மாறாது.",
    gloss: "The interest rate on this loan is fixed — it will never change.",
    docRef: "HL-FLOAT-11 · CLAUSE 2.8 · PRICING",
    clause:
      "Interest is floating and resets quarterly against the external benchmark (repo + 3.15% spread).",
    ok: false,
    label: "MISMATCH · SEVERITY 3",
    note: "Floating-rate product sold as fixed. Reset schedule and spread never disclosed to the customer.",
  },
  {
    lang: "BENGALI",
    font: "var(--font-bengali), 'Noto Sans Bengali', sans-serif",
    native:
      "আপনি যে কোনও সময় আপনার নমিনি পরিবর্তন করতে পারবেন, কোনও অসুবিধা নেই।",
    gloss: "You may change your nominee at any time, there is no problem with that.",
    docRef: "ULIP-2026-A · CLAUSE 11.4 · NOMINATION",
    clause:
      "The policyholder may alter the nomination at any time prior to maturity by written notice to the insurer.",
    ok: true,
    label: "MATCH · CLEAN",
    note: "Spoken claim is fully supported by the document. Logged as corroborated — no action required.",
  },
];

const POOL = [
  {
    spk: "AGENT",
    spkColor: "var(--ind)",
    font: "var(--font-deva), 'Noto Sans Devanagari', serif",
    native: "मैडम, ये स्कीम सिर्फ इसी महीने तक है।",
    en: "Ma'am, this scheme is only available till the end of this month.",
    flagged: true,
    flag: "ARTIFICIAL URGENCY · NOT IN DOC",
  },
  {
    spk: "CUSTOMER",
    spkColor: "var(--sf)",
    font: "var(--font-deva), 'Noto Sans Devanagari', serif",
    native: "मेरा पैसा कब तक फँसा रहेगा?",
    en: "How long will my money stay locked in?",
    flagged: false,
    flag: "",
  },
  {
    spk: "AGENT",
    spkColor: "var(--ind)",
    font: "var(--font-deva), 'Noto Sans Devanagari', serif",
    native: "फँसेगा नहीं, कभी भी निकाल सकती हैं।",
    en: "It won't be locked, you can withdraw whenever you like.",
    flagged: true,
    flag: "CONTRADICTS CLAUSE 9.1",
  },
  {
    spk: "CUSTOMER",
    spkColor: "var(--sf)",
    font: "var(--font-bengali), 'Noto Sans Bengali', sans-serif",
    native: "আর যদি আমি প্রিমিয়াম দিতে না পারি?",
    en: "And what if I cannot pay the premium?",
    flagged: false,
    flag: "",
  },
  {
    spk: "AGENT",
    spkColor: "var(--ind)",
    font: "var(--font-deva), 'Noto Sans Devanagari', serif",
    native: "कोई दिक्कत नहीं, पूरा पैसा वापस मिल जाता है।",
    en: "No problem at all, you get the entire amount back.",
    flagged: true,
    flag: "FALSE REFUND CLAIM · SEVERITY 4",
  },
  {
    spk: "CUSTOMER",
    spkColor: "var(--sf)",
    font: "var(--font-tamil), 'Noto Sans Tamil', sans-serif",
    native: "இது வங்கி வைப்புத்தொகை போலவா?",
    en: "Is this like a bank deposit?",
    flagged: false,
    flag: "",
  },
  {
    spk: "AGENT",
    spkColor: "var(--ind)",
    font: "var(--font-deva), 'Noto Sans Devanagari', serif",
    native: "बिल्कुल वैसा ही, बल्कि उससे भी सेफ।",
    en: "Exactly like that — in fact even safer than that.",
    flagged: true,
    flag: "RISK CLASS MISSTATED",
  },
  {
    spk: "CUSTOMER",
    spkColor: "var(--sf)",
    font: "var(--font-deva), 'Noto Sans Devanagari', serif",
    native: "ठीक है, कहाँ साइन करना है?",
    en: "Alright then, where do I sign?",
    flagged: false,
    flag: "",
  },
];

const ANCHORS = [
  { ref: "4.2", color: "var(--red)", text: "Returns are market-linked, not guaranteed" },
  { ref: "9.1", color: "var(--red)", text: "5-year lock-in; discontinuance charge applies" },
  { ref: "6.3", color: "var(--sf)", text: "Premium allocation charge up to 6% yr 1" },
  { ref: "11.4", color: "var(--cy)", text: "Nominee alterable before maturity" },
  { ref: "2.1", color: "var(--cy)", text: "Free-look period of 30 days" },
];

function stamp(sec: number) {
  const m = String(Math.floor(sec / 60)).padStart(2, "0");
  return `00:${m}:${String(sec % 60).padStart(2, "0")}`;
}

export function Landing() {
  const [phase, setPhase] = useState(0);
  const [scenarioIdx, setScenarioIdx] = useState(0);
  const [feed, setFeed] = useState<FeedRow[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [risk, setRisk] = useState(12);
  const [clockSec, setClockSec] = useState(12);

  useEffect(() => {
    const durations = [1500, 1300, 1600, 2400];
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = (p: number, s: number) => {
      timer = setTimeout(() => {
        if (cancelled) return;
        if (p >= 3) {
          const next = (s + 1) % SCENARIOS.length;
          setPhase(0);
          setScenarioIdx(next);
          tick(0, next);
        } else {
          const nextP = p + 1;
          setPhase(nextP);
          tick(nextP, s);
        }
      }, durations[p] ?? 1600);
    };
    tick(0, 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    const feedTimer = setInterval(() => {
      setFeed((prev) => {
        if (prev.length >= 6) {
          setAlerts([]);
          setRisk(12);
          return [];
        }
        const src = POOL[prev.length % POOL.length]!;
        const mm = 12 + prev.length * 6;
        const row: FeedRow = { ...src, time: stamp(mm) };
        if (row.flagged) {
          setAlerts((current) =>
            [
              {
                color: "var(--red)",
                title: `▲ ${row.flag}`,
                body: `"${row.en}" — no supporting clause found in ULIP-2026-A.`,
              },
              ...current,
            ].slice(0, 3),
          );
          setRisk((r) => Math.min(96, r + 21));
        } else {
          setRisk((r) => Math.min(96, r + 4));
        }
        return [...prev, row];
      });
    }, 2100);
    const clockTimer = setInterval(() => setClockSec((s) => s + 1), 1000);
    return () => {
      clearInterval(feedTimer);
      clearInterval(clockTimer);
    };
  }, []);

  const scenario = SCENARIOS[scenarioIdx]!;
  const phaseLabel = [
    "◉ LISTENING",
    "◉ TRANSCRIBED",
    "◉ ANCHORING TO DOC",
    scenario.ok ? "◉ CORROBORATED" : "◉ CONTRADICTION",
  ][phase]!;

  const riskLabel =
    risk > 70
      ? "ESCALATE — BLOCK SIGNATURE"
      : risk > 40
        ? "ELEVATED — SUPERVISOR PING"
        : "NOMINAL";

  const ticker = useMemo(
    () =>
      Array.from({ length: 44 }, (_, i) => {
        const h = 8 + Math.abs(Math.sin(i * 1.7 + clockSec * 0.4)) * 22;
        return {
          h: `${h.toFixed(0)}px`,
          color: i % 7 === 3 ? "var(--sf)" : "rgba(92,230,212,.55)",
        };
      }),
    [clockSec],
  );

  const riskBars = 24;
  const lit = Math.round((risk / 100) * riskBars);

  return (
    <div>
      {/* HERO */}
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
            Zub<span className="text-sf">aa</span>n
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
            <a
              href="#console"
              className="inline-flex min-h-12 items-center bg-cy px-6 font-mark text-[11px] tracking-[0.16em] text-ink transition-transform hover:brightness-105 active:scale-[0.98]"
            >
              REPLAY THE DEMO
            </a>
            <Link
              href="/call"
              className="inline-flex min-h-12 items-center border border-[rgba(239,232,218,0.28)] px-6 font-mono text-[11px] uppercase tracking-[0.14em] text-bone transition-colors hover:border-cy hover:text-cy"
            >
              Open live console
            </Link>
            <Link
              href="/import"
              className="inline-flex min-h-12 items-center px-4 font-mono text-[11px] uppercase tracking-[0.14em] text-dim transition-colors hover:text-bone"
            >
              Import a channel →
            </Link>
          </div>
        </div>
      </section>

      {/* MARQUEE */}
      <div className="overflow-hidden border-y border-[rgba(239,232,218,0.12)] bg-ink-soft py-3">
        <div className="flex w-max animate-[marquee_28s_linear_infinite] font-mono text-[11px] tracking-[0.2em] text-dim">
          {[0, 1].map((copy) => (
            <span key={copy} className="pr-8">
              MIS-SELLING IS A LANGUAGE PROBLEM ✳ ग़लत बिक्री एक भाषा की समस्या है ✳
              THE DOCUMENT IS IN ENGLISH ✳ THE PROMISE IS NOT ✳ தவறான விற்பனை ✳ ভুল
              বিক্রয় ✳
            </span>
          ))}
        </div>
      </div>

      {/* 01 MORPH */}
      <section id="witness" className="relative mx-auto max-w-[1240px] px-4 py-[110px] sm:px-6">
        <div className="mb-10 flex flex-wrap items-baseline gap-4">
          <span className="font-mark text-[11px] tracking-[0.2em] text-sf">
            01 — THE MORPH
          </span>
          <h2 className="m-0 font-display text-[clamp(38px,6vw,86px)] font-bold leading-[0.92] tracking-[-0.035em]">
            Spoken word,
            <br />
            <span className="text-dim">cross-examined.</span>
          </h2>
        </div>

        <div className="relative overflow-hidden border border-[rgba(239,232,218,0.16)] bg-[linear-gradient(180deg,var(--ink-soft),var(--ink))]">
          <div className="pointer-events-none absolute inset-y-0 w-[22%] animate-[sweep_3.6s_linear_infinite] bg-[linear-gradient(90deg,transparent,rgba(92,230,212,.07),transparent)]" />

          <div className="flex items-center justify-between gap-3 border-b border-[rgba(239,232,218,0.12)] px-4 py-3 font-mono text-[10px] tracking-[0.16em] text-dim sm:px-5">
            <span>
              SESSION ZB-4471 · {scenario.lang} → EN
            </span>
            <span className="flex items-center gap-3">
              <span className="text-cy">{phaseLabel}</span>
              <span className="size-[7px] bg-cy blink" />
            </span>
          </div>

          <div className="grid md:grid-cols-2">
            <div className="flex min-h-[340px] flex-col gap-5 border-b border-[rgba(239,232,218,0.12)] px-7 py-9 md:border-b-0 md:border-r">
              <span className="font-mark text-[10px] tracking-[0.18em] text-sf">
                WHAT THE AGENT SAID
              </span>
              <p
                key={`${scenarioIdx}-n-${phase}`}
                className="m-0 animate-rise text-[clamp(22px,2.4vw,34px)] leading-[1.5] text-bone"
                style={{ fontFamily: scenario.font }}
              >
                {scenario.native}
              </p>
              {phase >= 1 && (
                <p className="m-0 animate-rise border-l-2 border-cy pl-3.5 font-mono text-sm leading-[1.7] text-dim">
                  “{scenario.gloss}”
                </p>
              )}
              <div className="mt-auto flex h-11 items-end gap-0.5">
                {[0.1, 0.4, 0.7, 0.2, 0.55, 0.3].map((delay, i) => (
                  <i
                    key={i}
                    className="block flex-1 origin-bottom bg-sf opacity-85"
                    style={{
                      height: "100%",
                      animation: `bar ${0.5 + i * 0.12}s -${delay}s ease-in-out infinite alternate`,
                    }}
                  />
                ))}
              </div>
            </div>

            <div className="flex min-h-[340px] flex-col gap-5 px-7 py-9">
              <span className="font-mark text-[10px] tracking-[0.18em] text-dim">
                WHAT THE DOCUMENT SAYS
              </span>
              <p className="m-0 font-mono text-[11px] tracking-[0.14em] text-cy">
                {scenario.docRef}
              </p>
              {phase >= 2 ? (
                <p className="m-0 animate-rise text-[clamp(18px,2vw,26px)] leading-[1.45] text-bone">
                  {scenario.clause}
                </p>
              ) : (
                <p className="m-0 font-mono text-sm text-dim">
                  resolving clause…
                </p>
              )}
              {phase >= 3 && (
                <div
                  className="mt-auto animate-[pop_.3s_steps(4)_both] p-4"
                  style={{
                    background: scenario.ok ? "var(--cy)" : "var(--red)",
                    color: "var(--ink)",
                  }}
                >
                  <p className="m-0 font-mark text-[11px] tracking-[0.14em]">
                    {scenario.label}
                  </p>
                  <p className="mt-2 m-0 font-mono text-[11px] leading-relaxed">
                    {scenario.note}
                  </p>
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center justify-between gap-3 border-t border-[rgba(239,232,218,0.12)] px-4 py-3">
            <div className="flex gap-2">
              {SCENARIOS.map((_, i) => (
                <button
                  key={i}
                  type="button"
                  aria-label={`Scenario ${i + 1}`}
                  onClick={() => {
                    setScenarioIdx(i);
                    setPhase(0);
                  }}
                  className="size-2.5"
                  style={{
                    background:
                      i === scenarioIdx ? "var(--sf)" : "rgba(239,232,218,.2)",
                  }}
                />
              ))}
            </div>
            <button
              type="button"
              onClick={() => {
                setScenarioIdx((s) => (s + 1) % SCENARIOS.length);
                setPhase(0);
              }}
              className="font-mark text-[10px] tracking-[0.16em] text-bone transition-colors hover:text-cy"
            >
              NEXT CASE ▸
            </button>
          </div>
        </div>
      </section>

      {/* 02 DUET */}
      <section
        id="duet"
        className="relative border-t border-[rgba(239,232,218,0.12)] bg-ink-soft px-4 py-[110px] sm:px-6"
      >
        <div className="mx-auto grid max-w-[1240px] items-center gap-12 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
          <div className="space-y-5">
            <span className="font-mark text-[11px] tracking-[0.2em] text-sf">
              02 — TWO MOUTHS, ONE LEDGER
            </span>
            <h2 className="m-0 font-display text-[clamp(34px,4.6vw,64px)] font-bold leading-[0.96] tracking-[-0.03em]">
              A witness is not
              <br />
              an assistant.
            </h2>
            <p className="m-0 max-w-[46ch] text-pretty text-[17px] leading-[1.6] text-dim">
              An assistant serves whoever is holding it. A witness serves the
              record. Zubaan sits in the room, hears both sides, and writes down
              what was actually promised — timestamped, in the customer&apos;s own
              language, admissible before the signature.
            </p>
            <div className="mt-2 grid grid-cols-3 gap-px border border-[rgba(239,232,218,0.14)] bg-[rgba(239,232,218,0.14)]">
              <Metric value="340" unit="ms" label="FLAG LATENCY" accent="text-cy" />
              <Metric value="11" label="LANGUAGES" accent="text-sf" />
              <Metric value="0" label="AUDIO STORED" accent="text-red" />
            </div>
          </div>

          <div className="relative flex h-[420px] items-center justify-center">
            <div className="absolute size-[230px] animate-[ring_3.4s_ease-out_infinite] border border-[rgba(125,108,255,.45)]" />
            <div className="absolute size-[230px] animate-[ring_3.4s_1.7s_ease-out_infinite] border border-[rgba(92,230,212,.35)]" />
            <div className="absolute left-[6%] top-[20%] flex flex-col items-center gap-3">
              <div className="size-[104px] animate-[wob_9s_ease-in-out_infinite,breathe_2.4s_ease-in-out_infinite] bg-[linear-gradient(140deg,var(--ind),#3a2f8f)]" />
              <span className="font-mark text-[10px] tracking-[0.14em] text-dim">
                AGENT
              </span>
            </div>
            <div className="absolute bottom-[16%] right-[6%] flex flex-col items-center gap-3">
              <div className="size-[104px] animate-[wob_9s_1.2s_ease-in-out_infinite,breathe_2.4s_.6s_ease-in-out_infinite] bg-[linear-gradient(140deg,var(--sf),#b96a12)]" />
              <span className="font-mark text-[10px] tracking-[0.14em] text-dim">
                CUSTOMER
              </span>
            </div>
            <div className="relative z-[1] flex flex-col items-center gap-3">
              <div className="grid size-16 place-items-center border border-cy bg-ink font-mark text-[10px] tracking-[0.12em] text-cy">
                ZB
              </div>
              <span className="font-mark text-[10px] tracking-[0.14em] text-cy">
                WITNESS
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* 03 LIVE CONSOLE */}
      <section id="console" className="relative mx-auto max-w-[1400px] px-4 py-[110px] pb-[130px] sm:px-6">
        <div className="mb-9 flex flex-wrap items-baseline gap-4">
          <span className="font-mark text-[11px] tracking-[0.2em] text-sf">
            03 — LIVE CONSOLE
          </span>
          <h2 className="m-0 font-display text-[clamp(34px,5vw,72px)] font-bold leading-[0.94] tracking-[-0.035em]">
            The room, on the record.
          </h2>
        </div>

        <div className="panel">
          <div className="panel-chrome">
            <div className="dot-row" aria-hidden>
              <span className="bg-red" />
              <span className="bg-sf" />
              <span className="bg-cy" />
            </div>
            <span className="font-mono text-[11px] tracking-[0.1em] text-dim">
              zubaan://witness/live · ULIP-2026-A · branch_pune_04
            </span>
            <span className="ml-auto font-mark text-[10px] tracking-[0.14em] text-cy">
              {stamp(clockSec)}
            </span>
          </div>

          <div className="grid lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
            <div className="flex flex-col border-b border-[rgba(239,232,218,0.14)] lg:border-b-0 lg:border-r">
              <div className="flex items-center gap-3 border-b border-[rgba(239,232,218,0.1)] px-[18px] py-3">
                <span className="font-mark text-[10px] tracking-[0.16em] text-dim">
                  TRANSCRIPT STREAM
                </span>
                <span className="flex items-center gap-1.5 font-mono text-[10px] text-cy">
                  <span className="size-1.5 bg-cy blink" />
                  DIARIZING 2 SPEAKERS
                </span>
              </div>

              <div className="flex min-h-[430px] flex-col gap-3 p-[18px]">
                {feed.map((row) => (
                  <div
                    key={`${row.time}-${row.native}`}
                    className="grid animate-rise grid-cols-[78px_minmax(0,1fr)] gap-3.5"
                  >
                    <div className="flex flex-col gap-1 font-mono text-[10px] text-dim">
                      <span>{row.time}</span>
                      <span style={{ color: row.spkColor }}>{row.spk}</span>
                    </div>
                    <div
                      className="flex flex-col gap-1.5 border-l-2 pl-3"
                      style={{ borderColor: row.spkColor }}
                    >
                      <span
                        className="text-base leading-relaxed text-bone"
                        style={{ fontFamily: row.font }}
                      >
                        {row.native}
                      </span>
                      <span className="font-mono text-[11px] leading-relaxed text-dim">
                        {row.en}
                      </span>
                      {row.flagged && (
                        <span className="mt-1 w-fit animate-[pop_.25s_steps(3)_both] bg-red px-2 py-1 font-mark text-[9px] tracking-[0.12em] text-ink">
                          ▲ {row.flag}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
                <div className="mt-auto flex items-center gap-2 font-mono text-[11px] text-dim">
                  <span className="text-cy">▸</span>
                  <span>awaiting next utterance</span>
                  <span className="inline-block h-3.5 w-2 bg-cy blink" />
                </div>
              </div>
            </div>

            <div className="flex flex-col">
              <div className="flex flex-col gap-3 border-b border-[rgba(239,232,218,0.12)] p-[18px]">
                <span className="font-mark text-[10px] tracking-[0.16em] text-dim">
                  MIS-SELLING RISK
                </span>
                <div className="flex h-3 gap-0.5">
                  {Array.from({ length: riskBars }, (_, i) => {
                    let color = "rgba(78,203,113,.85)";
                    if (i > riskBars * 0.7) color = "var(--red)";
                    else if (i > riskBars * 0.45) color = "var(--sf)";
                    else if (i > riskBars * 0.25) color = "#c8e05a";
                    return (
                      <span
                        key={i}
                        className="flex-1"
                        style={{
                          background: i < lit ? color : "rgba(239,232,218,.08)",
                        }}
                      />
                    );
                  })}
                </div>
                <div className="flex items-center justify-between font-mono text-[11px]">
                  <span className={risk > 40 ? "text-sf" : "text-dim"}>
                    {riskLabel}
                  </span>
                  <span className="text-bone">{risk}%</span>
                </div>
              </div>

              <div className="flex flex-col gap-2.5 border-b border-[rgba(239,232,218,0.12)] p-[18px]">
                <span className="font-mark text-[10px] tracking-[0.16em] text-dim">
                  DOCUMENT ANCHORS
                </span>
                {ANCHORS.map((a) => (
                  <div
                    key={a.ref}
                    className="flex items-center gap-2.5 font-mono text-[11px]"
                  >
                    <span
                      className="size-2 shrink-0"
                      style={{ background: a.color }}
                    />
                    <span className="shrink-0 text-dim">{a.ref}</span>
                    <span className="truncate text-bone">{a.text}</span>
                  </div>
                ))}
              </div>

              <div className="flex flex-1 flex-col gap-2.5 p-[18px]">
                <span className="font-mark text-[10px] tracking-[0.16em] text-dim">
                  WITNESS LOG
                </span>
                {alerts.length === 0 && (
                  <p className="font-mono text-[11px] text-dim">
                    clean so far — waiting for the first unsupported claim
                  </p>
                )}
                {alerts.map((al) => (
                  <div
                    key={al.title + al.body}
                    className="flex animate-[pop_.3s_steps(4)_both] gap-2.5 border bg-[rgba(255,255,255,.02)] px-3 py-2.5"
                    style={{ borderColor: al.color }}
                  >
                    <span
                      className="mt-1 size-2.5 shrink-0"
                      style={{ background: al.color }}
                    />
                    <div className="flex min-w-0 flex-col gap-1">
                      <span
                        className="font-mark text-[10px] tracking-[0.12em]"
                        style={{ color: al.color }}
                      >
                        {al.title}
                      </span>
                      <span className="font-mono text-[11px] leading-[1.55] text-dim">
                        {al.body}
                      </span>
                    </div>
                  </div>
                ))}
                <div className="mt-auto flex items-center gap-2 font-mono text-[11px] text-dim">
                  <span className="text-cy">▸</span>
                  <span>awaiting next utterance</span>
                  <span className="inline-block h-3.5 w-2 bg-cy blink" />
                </div>
              </div>
            </div>
          </div>

          <div className="flex h-10 overflow-hidden border-t border-[rgba(239,232,218,0.14)]">
            <div className="flex w-max animate-[tick_4s_linear_infinite] items-end gap-0.5 py-2">
              {[...ticker, ...ticker].map((t, i) => (
                <span
                  key={i}
                  className="w-1.5 self-end"
                  style={{ height: t.h, background: t.color }}
                />
              ))}
            </div>
          </div>
        </div>

        <div className="mt-8 flex flex-wrap gap-3">
          <Link
            href="/call"
            className="inline-flex min-h-12 items-center bg-cy px-6 font-mark text-[11px] tracking-[0.16em] text-ink"
          >
            ENTER LIVE WORKSPACE
          </Link>
          <Link
            href="/inbox"
            className="inline-flex min-h-12 items-center border border-[rgba(239,232,218,0.28)] px-6 font-mono text-[11px] uppercase tracking-[0.14em] text-bone"
          >
            Open inbox
          </Link>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="border-t border-[rgba(239,232,218,0.14)] bg-ink px-4 py-[70px] pb-10 sm:px-6">
        <div className="mx-auto flex max-w-[1240px] flex-col gap-11">
          <h2 className="m-0 text-balance font-display text-[clamp(30px,5.4vw,80px)] font-extrabold leading-[0.95] tracking-[-0.04em]">
            Let them speak.
            <br />
            <span className="text-sf">We&apos;ll keep the receipt.</span>
          </h2>
          <div className="flex flex-wrap items-center gap-3.5">
            <a
              href="https://github.com/Anandb71/Zubaan"
              target="_blank"
              rel="noreferrer"
              className="bg-cy px-5 py-3.5 font-mark text-[11px] tracking-[0.14em] text-ink transition-colors hover:bg-sf"
            >
              GITHUB ↗
            </a>
            <Link
              href="/call"
              className="border border-[rgba(239,232,218,0.3)] px-5 py-3.5 font-mark text-[11px] tracking-[0.14em] text-bone transition-colors hover:border-sf hover:text-sf"
            >
              REPLAY THE DEMO
            </Link>
          </div>
          <div className="flex flex-wrap justify-between gap-5 border-t border-[rgba(239,232,218,0.12)] pt-5 font-mono text-[10px] tracking-[0.1em] text-dim">
            <span>ZUBAAN · ज़ुबान · जबान · জবান · ஜுபான்</span>
            <span>ON-DEVICE ASR · NO AUDIO RETAINED · IRDAI / SEBI ALIGNED</span>
          </div>
        </div>
      </footer>
    </div>
  );
}

function Metric({
  value,
  unit,
  label,
  accent,
}: {
  value: string;
  unit?: string;
  label: string;
  accent: string;
}) {
  return (
    <div className="flex flex-col gap-1.5 bg-ink-soft px-4 py-[18px]">
      <span className={`font-mono text-[28px] ${accent}`}>
        {value}
        {unit ? <span className="text-[15px]">{unit}</span> : null}
      </span>
      <span className="font-mark text-[9px] tracking-[0.14em] text-dim">
        {label}
      </span>
    </div>
  );
}
