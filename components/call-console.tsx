"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { DEMO_SCRIPT } from "@/dev/fixtures/zubaan-demo";
import { languageLabel } from "@/lib/i18n/languages";
import type { Call, Utterance, Violation } from "@/lib/models";
import { MockSttStream, SttStream, type LiveSttStream } from "@/lib/sarvam/stt-client";
import type { SttSession } from "@/lib/sarvam/stt";
import type { SttEvent } from "@/lib/sarvam/types";

type Phase = "idle" | "listening" | "ending" | "done" | "error";

interface TranscriptLine {
  id: string;
  text: string;
  tsMs: number;
  language?: string;
  partial?: boolean;
}

export function CallConsole() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [mode, setMode] = useState<"live" | "stage">("live");
  const [liveReady, setLiveReady] = useState(false);
  const [call, setCall] = useState<Call | null>(null);
  const [lines, setLines] = useState<TranscriptLine[]>([]);
  const [partial, setPartial] = useState("");
  const [violations, setViolations] = useState<Violation[]>([]);
  const [detectedLang, setDetectedLang] = useState<string>("unknown");
  const [status, setStatus] = useState("Checking Sarvam live path…");
  const [auditId, setAuditId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/health");
        const data = await res.json();
        if (cancelled) return;
        const ready = data?.sarvam === "live";
        setLiveReady(ready);
        setMode(ready ? "live" : "stage");
        setStatus(
          ready
            ? "Live ready — mic → Saaras v3 → sarvam-30b flags"
            : "Stage mode — scripted demo (no live Sarvam key)",
        );
      } catch {
        if (!cancelled) {
          setLiveReady(false);
          setMode("stage");
          setStatus("Stage mode — could not reach /api/health");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const streamRef = useRef<LiveSttStream | null>(null);
  const callIdRef = useRef<string | null>(null);
  const langRef = useRef("unknown");
  const bufferRef = useRef<Utterance[]>([]);
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startedAtRef = useRef(0);
  const mediaRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const transcriptEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [lines, partial]);

  const flushWindow = useCallback(async () => {
    const id = callIdRef.current;
    const batch = bufferRef.current.splice(0, bufferRef.current.length);
    if (!id || batch.length === 0) return;

    try {
      const res = await fetch(`/api/calls/${id}/window`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          utterances: batch,
          detectedLang: langRef.current !== "unknown" ? langRef.current : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? "window check failed");
      if (data.violations?.length) {
        setViolations((prev) => {
          const ids = new Set(prev.map((v) => v.id));
          return [...prev, ...data.violations.filter((v: Violation) => !ids.has(v.id))];
        });
      }
      if (data.call) setCall(data.call);
      setStatus(
        data.violations?.length
          ? `Flagged ${data.violations.length} contradiction(s)`
          : "Listening — no unsupported claim in this window",
      );
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Window check failed");
    }
  }, []);

  const scheduleFlush = useCallback(() => {
    if (flushTimerRef.current) return;
    flushTimerRef.current = setTimeout(() => {
      flushTimerRef.current = null;
      void flushWindow();
    }, 4000);
  }, [flushWindow]);

  const onSttEvent = useCallback(
    (event: SttEvent) => {
      if (event.type === "language") {
        langRef.current = event.code;
        setDetectedLang(event.code);
      }
      if (event.type === "partial") {
        setPartial(event.text);
        if (event.language) {
          langRef.current = event.language;
          setDetectedLang(event.language);
        }
      }
      if (event.type === "final") {
        setPartial("");
        const tsMs = event.startMs ?? Date.now() - startedAtRef.current;
        const utterance: Utterance = {
          tsMs,
          text: event.text,
          language: event.language ?? langRef.current,
          final: true,
        };
        bufferRef.current.push(utterance);
        setLines((prev) => [
          ...prev.filter((l) => !l.partial),
          {
            id: `${tsMs}-${prev.length}`,
            text: event.text,
            tsMs,
            language: utterance.language,
          },
        ]);
        if (event.language) {
          langRef.current = event.language;
          setDetectedLang(event.language);
        }
        scheduleFlush();
      }
      if (event.type === "error") {
        setStatus(event.message);
        if (!event.retriable) setError(event.message);
      }
      if (event.type === "reconnecting") {
        setStatus(`Reconnecting STT (attempt ${event.attempt})…`);
      }
    },
    [scheduleFlush],
  );

  const stopMic = useCallback(() => {
    processorRef.current?.disconnect();
    processorRef.current = null;
    void audioCtxRef.current?.close();
    audioCtxRef.current = null;
    mediaRef.current?.getTracks().forEach((t) => t.stop());
    mediaRef.current = null;
  }, []);

  const startMic = useCallback(async (stream: LiveSttStream) => {
    const media = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    mediaRef.current = media;
    // Browsers often ignore requested 16kHz — resample from the actual rate.
    const ctx = new AudioContext();
    audioCtxRef.current = ctx;
    if (ctx.state === "suspended") await ctx.resume();
    const source = ctx.createMediaStreamSource(media);
    const processor = ctx.createScriptProcessor(4096, 1, 1);
    processorRef.current = processor;
    processor.onaudioprocess = (e) => {
      const input = e.inputBuffer.getChannelData(0);
      const resampled = downsampleTo16k(input, ctx.sampleRate);
      stream.sendAudio(floatTo16BitPCM(resampled));
    };
    source.connect(processor);
    // Keep the graph alive without audible feedback.
    const mute = ctx.createGain();
    mute.gain.value = 0;
    processor.connect(mute);
    mute.connect(ctx.destination);
  }, []);

  const start = useCallback(async () => {
    setError(null);
    setAuditId(null);
    setViolations([]);
    setLines([]);
    setPartial("");
    setPhase("listening");
    setStatus("Starting call…");
    startedAtRef.current = Date.now();

    try {
      const created = await fetch("/api/demo/calls", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerName: "Sunita Devi",
          customerLang: "ta-IN",
        }),
      });
      const createdData = await created.json();
      if (!created.ok) throw new Error(createdData?.error?.message ?? "Could not start call");
      const nextCall = createdData.call as Call;
      setCall(nextCall);
      callIdRef.current = nextCall.id;

      let stream: LiveSttStream;
      if (mode === "stage") {
        stream = new MockSttStream(DEMO_SCRIPT, onSttEvent, 1);
        setStatus("Stage mode — scripted Hindi sale playing");
      } else {
        const sessionRes = await fetch("/api/stt/session");
        const sessionData = await sessionRes.json();
        if (!sessionData.session) {
          stream = new MockSttStream(DEMO_SCRIPT, onSttEvent, 1);
          setMode("stage");
          setStatus("No live STT key — falling back to stage script");
        } else {
          stream = new SttStream({
            // Fresh URL on every reconnect so long calls don't die on expiry.
            sessionProvider: async () => {
              const r = await fetch("/api/stt/session");
              const j = await r.json();
              return (j.session as SttSession) ?? null;
            },
            onEvent: onSttEvent,
          });
          await stream.start();
          await startMic(stream);
          setStatus("LIVE — speak Hindi/English lies; red cards under 2s");
          streamRef.current = stream;
          return;
        }
      }

      streamRef.current = stream;
      await stream.start();
    } catch (e) {
      setPhase("error");
      setError(e instanceof Error ? e.message : "Failed to start");
      stopMic();
    }
  }, [mode, onSttEvent, startMic, stopMic]);

  const end = useCallback(async () => {
    setPhase("ending");
    setStatus("Ending call — running omission check + Tamil audit…");
    if (flushTimerRef.current) {
      clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }
    await flushWindow();
    await streamRef.current?.finish();
    streamRef.current = null;
    stopMic();

    const id = callIdRef.current;
    if (!id) {
      setPhase("error");
      setError("No active call");
      return;
    }

    try {
      const res = await fetch(`/api/calls/${id}/end`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? "End call failed");
      if (data.omissions?.length) {
        setViolations((prev) => {
          const ids = new Set(prev.map((v) => v.id));
          return [...prev, ...data.omissions.filter((v: Violation) => !ids.has(v.id))];
        });
      }
      setAuditId(data.audit.id);
      setPhase("done");
      setStatus(
        data.degraded
          ? "Audit ready (degraded / heuristic path)"
          : "Audit ready — play in Tamil before signing",
      );
    } catch (e) {
      setPhase("error");
      setError(e instanceof Error ? e.message : "End call failed");
    }
  }, [flushWindow, stopMic]);

  useEffect(() => {
    return () => {
      if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
      streamRef.current?.close();
      stopMic();
    };
  }, [stopMic]);

  // Auto-end after the stage script finishes (~28s).
  useEffect(() => {
    if (phase !== "listening" || mode !== "stage") return;
    const t = setTimeout(() => {
      void end();
    }, 29_000);
    return () => clearTimeout(t);
  }, [phase, mode, end]);

  return (
    <div className="grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
      <section className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-saffron">
              Agent console
            </p>
            <h1 className="font-display mt-1 text-3xl font-semibold tracking-tight sm:text-4xl">
              Live call
            </h1>
            <p className="mt-2 max-w-xl text-sm text-[var(--text-muted)]">
              Suraksha Growth Plus · customer audit language: Tamil · spoken: auto-detect
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-md border hairline px-3 py-2 text-xs font-semibold text-[var(--text-muted)]">
              Detected:{" "}
              <span className="text-[var(--text)]">
                {detectedLang === "unknown" ? "—" : languageLabel(detectedLang)}
              </span>
            </span>
            <span
              className={[
                "rounded-md px-3 py-2 text-xs font-bold uppercase tracking-[0.14em]",
                liveReady ? "bg-safe/20 text-safe" : "bg-ink-soft text-[var(--text-muted)]",
              ].join(" ")}
            >
              {liveReady ? "Sarvam live" : "Offline / stage"}
            </span>
            <div className="flex rounded-md border hairline p-1">
              <ModeButton active={mode === "stage"} onClick={() => setMode("stage")} disabled={phase === "listening"}>
                Stage
              </ModeButton>
              <ModeButton
                active={mode === "live"}
                onClick={() => setMode("live")}
                disabled={phase === "listening" || !liveReady}
              >
                Live mic
              </ModeButton>
            </div>
          </div>
        </div>

        <div className="rounded-2xl border hairline bg-ink-soft/70 p-4 sm:p-5">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--text-muted)]">
                Transcript
              </p>
              <p className="mt-1 text-sm text-[var(--text-muted)]">{status}</p>
            </div>
            {phase === "listening" && (
              <div className="flex h-8 items-end gap-1" aria-hidden>
                {[0, 1, 2, 3, 4].map((i) => (
                  <span
                    key={i}
                    className="w-1.5 origin-bottom rounded-full bg-saffron animate-level-pulse"
                    style={{ height: `${10 + i * 4}px`, animationDelay: `${i * 90}ms` }}
                  />
                ))}
              </div>
            )}
          </div>

          <div className="scrollbar-thin h-[min(52vh,420px)] space-y-3 overflow-y-auto pr-1">
            {lines.length === 0 && !partial && (
              <p className="text-sm text-[var(--text-muted)]">
                Press record. Stage mode sells a policy in Hindi, lies twice, and leaves out free-look.
              </p>
            )}
            {lines.map((line) => (
              <div key={line.id} className="rounded-xl bg-ink/60 px-3 py-2.5">
                <div className="mb-1 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">
                  <span className="tabular">{formatTs(line.tsMs)}</span>
                  {line.language && <span>{languageLabel(line.language)}</span>}
                </div>
                <p className="text-[15px] leading-relaxed text-[var(--text)]">{line.text}</p>
              </div>
            ))}
            {partial && (
              <div className="rounded-xl border border-dashed border-[color-mix(in_oklch,var(--line)_70%,transparent)] px-3 py-2.5 opacity-70">
                <p className="text-[15px] leading-relaxed">{partial}</p>
              </div>
            )}
            <div ref={transcriptEndRef} />
          </div>

          <div className="mt-5 flex flex-wrap gap-3">
            {phase === "idle" || phase === "done" || phase === "error" ? (
              <button
                type="button"
                onClick={() => void start()}
                className="min-h-12 cursor-pointer rounded-xl bg-saffron px-6 text-sm font-bold text-ink transition-transform duration-150 hover:brightness-105 active:scale-[0.98]"
              >
                {phase === "done" ? "Run again" : "Start recording"}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void end()}
                disabled={phase === "ending"}
                className="min-h-12 cursor-pointer rounded-xl bg-signal px-6 text-sm font-bold text-[var(--text)] transition-transform duration-150 hover:brightness-110 active:scale-[0.98] disabled:opacity-50"
              >
                {phase === "ending" ? "Auditing…" : "End call"}
              </button>
            )}
            {auditId && (
              <Link
                href={`/audit/${auditId}`}
                className="inline-flex min-h-12 items-center rounded-xl border hairline px-5 text-sm font-semibold text-[var(--text)] transition-colors hover:bg-ink"
              >
                Open customer audit
              </Link>
            )}
          </div>
          {error && (
            <p className="mt-3 text-sm font-medium text-signal" role="alert">
              {error}
            </p>
          )}
          {call && (
            <p className="mt-3 text-xs text-[var(--text-muted)]">
              Call {call.id.slice(0, 8)} · disclosures satisfied:{" "}
              {call.satisfiedDisclosureIds.length}
            </p>
          )}
        </div>
      </section>

      <section className="space-y-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-signal">
            Check A · contradictions
          </p>
          <h2 className="font-display mt-1 text-2xl font-semibold">Live flags</h2>
          <p className="mt-1 text-sm text-[var(--text-muted)]">
            Red cards must appear under 2s. You said / Document says / Say instead.
          </p>
        </div>

        <div className="space-y-3">
          {violations.filter((v) => v.kind === "contradiction").length === 0 && (
            <div className="rounded-2xl border hairline bg-ink-soft/50 px-4 py-8 text-center text-sm text-[var(--text-muted)]">
              No unsupported claims yet. The first lie lights this panel red.
            </div>
          )}
          {violations
            .filter((v) => v.kind === "contradiction")
            .map((v) => (
              <article
                key={v.id}
                className="signal-card rounded-2xl border border-[color-mix(in_oklch,var(--signal)_55%,transparent)] bg-[color-mix(in_oklch,var(--signal)_14%,var(--ink))] p-4"
              >
                <div className="mb-3 flex items-center justify-between gap-2">
                  <span className="rounded-md bg-signal px-2 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--text)]">
                    {v.severity} contradiction
                  </span>
                  <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">
                    {v.source}
                  </span>
                </div>
                <FlagRow label="You said" value={v.utterance || v.claimMade || "—"} />
                <FlagRow label="Document says" value={v.contradictedBy || "—"} />
                <FlagRow label="Say instead" value={v.suggestedCorrection || "—"} />
              </article>
            ))}
        </div>

        {violations.some((v) => v.kind === "omission") && (
          <div className="space-y-3 pt-2">
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-saffron">
              Check B · omissions
            </p>
            {violations
              .filter((v) => v.kind === "omission")
              .map((v) => (
                <article
                  key={v.id}
                  className="signal-card rounded-2xl border hairline bg-ink-soft/70 p-4"
                >
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-saffron">
                    Never stated · {v.disclosureId}
                  </p>
                  <p className="mt-2 text-sm leading-relaxed text-[var(--text)]">
                    {v.contradictedBy}
                  </p>
                </article>
              ))}
          </div>
        )}
      </section>
    </div>
  );
}

function ModeButton({
  active,
  onClick,
  disabled,
  children,
}: {
  active: boolean;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={[
        "min-h-9 cursor-pointer rounded-md px-3 text-xs font-semibold transition-colors",
        active ? "bg-saffron text-ink" : "text-[var(--text-muted)] hover:text-[var(--text)]",
      ].join(" ")}
    >
      {children}
    </button>
  );
}

function FlagRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="mt-2">
      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">
        {label}
      </p>
      <p className="mt-1 text-sm leading-relaxed text-[var(--text)]">{value}</p>
    </div>
  );
}

function formatTs(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}

function floatTo16BitPCM(input: Float32Array): ArrayBuffer {
  const buffer = new ArrayBuffer(input.length * 2);
  const view = new DataView(buffer);
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i]!));
    view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return buffer;
}

function downsampleTo16k(input: Float32Array, fromRate: number): Float32Array {
  if (fromRate === 16_000) return input;
  const ratio = fromRate / 16_000;
  const length = Math.max(1, Math.floor(input.length / ratio));
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    out[i] = input[Math.floor(i * ratio)] ?? 0;
  }
  return out;
}
