"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { DEMO_SCRIPT } from "@/dev/fixtures/zubaan-demo";
import { languageLabel } from "@/lib/i18n/languages";
import type { Call, Utterance, Violation } from "@/lib/models";
import {
  MockSttStream,
  RelaySttStream,
  type LiveSttStream,
} from "@/lib/sarvam/stt-client";
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
        const relay = new RelaySttStream({ onEvent: onSttEvent });
        try {
          await relay.start();
          await startMic(relay);
          setStatus("LIVE SECURE RELAY — speak Hindi/English; key stays server-side");
          streamRef.current = relay;
          return;
        } catch {
          relay.close();
          stream = new MockSttStream(DEMO_SCRIPT, onSttEvent, 1);
          setMode("stage");
          setStatus("Secure relay unavailable — falling back to stage script");
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
    <div className="space-y-7">
      <div className="flex flex-wrap items-baseline gap-4">
        <span className="font-mark text-[11px] tracking-[0.2em] text-sf">
          03 — LIVE CONSOLE
        </span>
        <h1 className="m-0 font-display text-[clamp(34px,5vw,64px)] font-bold leading-[0.94] tracking-[-0.035em]">
          The room, on the record.
        </h1>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="border border-[rgba(239,232,218,0.18)] px-3 py-2 font-mono text-[11px] text-dim">
          Detected:{" "}
          <span className="text-bone">
            {detectedLang === "unknown" ? "—" : languageLabel(detectedLang)}
          </span>
        </span>
        <span
          className={[
            "px-3 py-2 font-mark text-[10px] tracking-[0.14em]",
            liveReady ? "bg-cy/15 text-cy" : "bg-ink-3 text-dim",
          ].join(" ")}
        >
          {liveReady ? "SARVAM LIVE" : "STAGE MODE"}
        </span>
        <div className="flex border border-[rgba(239,232,218,0.18)] p-1">
          <ModeButton
            active={mode === "stage"}
            onClick={() => setMode("stage")}
            disabled={phase === "listening"}
          >
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
            {phase === "listening" ? "REC" : "STANDBY"}
          </span>
        </div>

        <div className="grid lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
          <section className="flex flex-col border-b border-[rgba(239,232,218,0.14)] lg:border-b-0 lg:border-r">
            <div className="flex items-center gap-3 border-b border-[rgba(239,232,218,0.1)] px-4 py-3">
              <span className="font-mark text-[10px] tracking-[0.16em] text-dim">
                TRANSCRIPT STREAM
              </span>
              <span className="flex items-center gap-2 font-mono text-[10px] text-cy">
                <span
                  className={[
                    "size-1.5 bg-cy",
                    phase === "listening" ? "blink" : "",
                  ].join(" ")}
                />
                {phase === "listening" ? "DIARIZING 2 SPEAKERS" : "AWAITING"}
              </span>
              {phase === "listening" && (
                <div className="ml-auto flex h-6 items-end gap-1" aria-hidden>
                  {[0, 1, 2, 3, 4].map((i) => (
                    <span
                      key={i}
                      className="w-1 origin-bottom bg-sf animate-level-pulse"
                      style={{
                        height: `${8 + i * 3}px`,
                        animationDelay: `${i * 90}ms`,
                      }}
                    />
                  ))}
                </div>
              )}
            </div>

            <div className="scrollbar-thin min-h-[430px] space-y-3 overflow-y-auto p-4">
              <p className="font-mono text-[11px] text-dim">{status}</p>
              {lines.length === 0 && !partial && (
                <p className="text-sm text-dim">
                  Press record. Stage mode sells a policy in Hindi, lies twice, and
                  leaves out free-look.
                </p>
              )}
              {lines.map((line) => (
                <div
                  key={line.id}
                  className="grid animate-rise grid-cols-[72px_minmax(0,1fr)] gap-3"
                >
                  <div className="flex flex-col gap-1 font-mono text-[10px] text-dim">
                    <span className="tabular">{formatTs(line.tsMs)}</span>
                    {line.language && (
                      <span className="text-cy">{languageLabel(line.language)}</span>
                    )}
                  </div>
                  <div className="border-l-2 border-cy pl-3">
                    <p className="text-[16px] leading-relaxed text-bone">{line.text}</p>
                  </div>
                </div>
              ))}
              {partial && (
                <div className="grid grid-cols-[72px_minmax(0,1fr)] gap-3 opacity-70">
                  <span className="font-mono text-[10px] text-dim">…</span>
                  <div className="border-l-2 border-dim pl-3">
                    <p className="text-[16px] leading-relaxed text-bone">{partial}</p>
                  </div>
                </div>
              )}
              <div ref={transcriptEndRef} />
            </div>

            <div className="flex flex-wrap gap-3 border-t border-[rgba(239,232,218,0.12)] p-4">
              {phase === "idle" || phase === "done" || phase === "error" ? (
                <button
                  type="button"
                  onClick={() => void start()}
                  className="min-h-12 cursor-pointer bg-cy px-6 font-mark text-[11px] tracking-[0.16em] text-ink transition-transform hover:brightness-105 active:scale-[0.98]"
                >
                  {phase === "done" ? "RUN AGAIN" : "START RECORDING"}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => void end()}
                  disabled={phase === "ending"}
                  className="min-h-12 cursor-pointer bg-red px-6 font-mark text-[11px] tracking-[0.16em] text-ink transition-transform hover:brightness-110 active:scale-[0.98] disabled:opacity-50"
                >
                  {phase === "ending" ? "AUDITING…" : "END CALL"}
                </button>
              )}
              {auditId && (
                <Link
                  href={`/audit/${auditId}`}
                  className="inline-flex min-h-12 items-center border border-[rgba(239,232,218,0.28)] px-5 font-mono text-[11px] uppercase tracking-[0.12em] text-bone transition-colors hover:border-cy hover:text-cy"
                >
                  Open customer audit
                </Link>
              )}
              {error && (
                <p className="w-full text-sm font-medium text-red" role="alert">
                  {error}
                </p>
              )}
              {call && (
                <p className="w-full font-mono text-[11px] text-dim">
                  Call {call.id.slice(0, 8)} · disclosures satisfied:{" "}
                  {call.satisfiedDisclosureIds.length}
                </p>
              )}
            </div>
          </section>

          <section className="flex flex-col">
            <div className="border-b border-[rgba(239,232,218,0.12)] px-4 py-3">
              <span className="font-mark text-[10px] tracking-[0.16em] text-dim">
                MIS-SELLING RISK
              </span>
              <p className="mt-1 font-mono text-[11px] text-dim">
                You said / Document says / Say instead — under 2s.
              </p>
            </div>

            <div className="space-y-3 p-4">
              {violations.filter((v) => v.kind === "contradiction").length === 0 && (
                <div className="border border-[rgba(239,232,218,0.12)] bg-ink px-4 py-10 text-center font-mono text-[12px] text-dim">
                  awaiting next utterance
                </div>
              )}
              {violations
                .filter((v) => v.kind === "contradiction")
                .map((v) => (
                  <article
                    key={v.id}
                    className="signal-card border border-[rgba(255,77,61,0.45)] bg-[rgba(255,77,61,0.1)] p-4"
                  >
                    <div className="mb-3 flex items-center justify-between gap-2">
                      <span className="bg-red px-2 py-1 font-mark text-[9px] tracking-[0.12em] text-ink">
                        ▲ {v.severity} contradiction
                      </span>
                      <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-dim">
                        {v.source}
                      </span>
                    </div>
                    <FlagRow
                      label="You said"
                      value={v.utterance || v.claimMade || "—"}
                    />
                    <FlagRow label="Document says" value={v.contradictedBy || "—"} />
                    <FlagRow
                      label="Say instead"
                      value={v.suggestedCorrection || "—"}
                    />
                  </article>
                ))}

              {violations
                .filter((v) => v.kind === "omission")
                .map((v) => (
                  <article
                    key={v.id}
                    className="signal-card border border-[rgba(255,179,71,0.4)] bg-[rgba(255,179,71,0.08)] p-4"
                  >
                    <p className="font-mark text-[10px] tracking-[0.14em] text-sf">
                      NEVER STATED · {v.disclosureId}
                    </p>
                    <p className="mt-2 text-sm leading-relaxed text-bone">
                      {v.contradictedBy}
                    </p>
                  </article>
                ))}
            </div>
          </section>
        </div>
      </div>
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
        "min-h-9 cursor-pointer px-3 font-mono text-[11px] uppercase tracking-[0.12em] transition-colors",
        active ? "bg-sf text-ink" : "text-dim hover:text-bone",
      ].join(" ")}
    >
      {children}
    </button>
  );
}

function FlagRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="mt-2">
      <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-dim">
        {label}
      </p>
      <p className="mt-1 text-sm leading-relaxed text-bone">{value}</p>
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
