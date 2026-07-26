"use client";

/**
 * Browser-side Saaras v3 streaming client.
 *
 * Wire format (verified against Sarvam AsyncAPI):
 *   outbound audio: { audio: { data: base64, sample_rate: "16000", encoding: "audio/wav" } }
 *   outbound flush: { type: "flush" }
 *   inbound: { type: "data"|"events"|"error", data: {...} }
 *
 * For mic PCM we either:
 *   - set input_audio_codec=pcm_s16le on the URL and wrap each chunk as a tiny WAV, or
 *   - send pcm bytes as WAV-framed base64 (always safe).
 */

import { backoffDelay } from "@/lib/resilience/backoff";
import type { SttEvent, SttStreamOptions } from "./types";
import type { SttSession } from "./stt";

export interface LiveSttStream {
  start(): Promise<void>;
  sendAudio(pcm: ArrayBuffer): void;
  finish(): Promise<void>;
  close(): void;
}

export interface SttClientConfig {
  sessionProvider: () => Promise<SttSession | null>;
  onEvent: (e: SttEvent) => void;
  options?: SttStreamOptions;
  maxReconnects?: number;
  maxBufferedFrames?: number;
}

export class SttStream implements LiveSttStream {
  private ws: WebSocket | null = null;
  private buffer: ArrayBuffer[] = [];
  private closedByUser = false;
  private attempt = 0;
  private readonly maxReconnects: number;
  private readonly maxBuffered: number;

  constructor(private readonly cfg: SttClientConfig) {
    this.maxReconnects = cfg.maxReconnects ?? 6;
    this.maxBuffered = cfg.maxBufferedFrames ?? 400;
  }

  async start(): Promise<void> {
    this.closedByUser = false;
    this.attempt = 0;
    await this.connect();
  }

  sendAudio(pcm: ArrayBuffer): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(encodeAudioMessage(pcm));
        return;
      } catch {
        /* buffer and reconnect */
      }
    }
    this.buffer.push(pcm);
    while (this.buffer.length > this.maxBuffered) this.buffer.shift();
  }

  async finish(): Promise<void> {
    this.flush();
    if (this.ws?.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify({ type: "flush" }));
      } catch {
        /* best effort */
      }
    }
    await new Promise((r) => setTimeout(r, 500));
    this.close();
  }

  close(): void {
    this.closedByUser = true;
    try {
      this.ws?.close();
    } catch {
      /* ignore */
    }
    this.ws = null;
    this.buffer = [];
  }

  private async connect(): Promise<void> {
    let session: SttSession | null = null;
    try {
      session = await this.cfg.sessionProvider();
    } catch {
      session = null;
    }
    if (!session) {
      this.cfg.onEvent({
        type: "error",
        message: "no STT session available",
        retriable: false,
      });
      return;
    }

    let ws: WebSocket;
    try {
      ws = new WebSocket(session.url);
    } catch (e) {
      this.cfg.onEvent({ type: "error", message: String(e), retriable: true });
      this.scheduleReconnect();
      return;
    }

    ws.binaryType = "arraybuffer";
    this.ws = ws;

    ws.onopen = () => {
      this.attempt = 0;
      this.cfg.onEvent({ type: "open" });
      this.flush();
    };
    ws.onmessage = (ev: MessageEvent) => this.handleMessage(ev.data);
    ws.onerror = () =>
      this.cfg.onEvent({ type: "error", message: "socket error", retriable: true });
    ws.onclose = (ev: CloseEvent) => {
      this.cfg.onEvent({ type: "close", code: ev.code });
      if (!this.closedByUser) this.scheduleReconnect();
    };
  }

  private flush(): void {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    while (this.buffer.length > 0) {
      const frame = this.buffer.shift()!;
      try {
        this.ws.send(encodeAudioMessage(frame));
      } catch {
        this.buffer.unshift(frame);
        break;
      }
    }
  }

  private scheduleReconnect(): void {
    if (this.closedByUser) return;
    if (this.attempt >= this.maxReconnects) {
      this.cfg.onEvent({
        type: "error",
        message: "STT reconnect limit reached",
        retriable: false,
      });
      return;
    }
    const wait = backoffDelay(this.attempt, { baseMs: 400, maxMs: 6_000 });
    this.attempt += 1;
    this.cfg.onEvent({ type: "reconnecting", attempt: this.attempt });
    setTimeout(() => {
      if (!this.closedByUser) void this.connect();
    }, wait);
  }

  private handleMessage(data: unknown): void {
    if (typeof data !== "string") return;

    let msg: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(data);
      if (!parsed || typeof parsed !== "object") return;
      msg = parsed as Record<string, unknown>;
    } catch {
      return;
    }

    const type = pickStr(msg, "type");
    const payload =
      msg.data && typeof msg.data === "object" && !Array.isArray(msg.data)
        ? (msg.data as Record<string, unknown>)
        : msg;

    if (type === "error") {
      const message =
        pickStr(payload, "error") ??
        pickStr(payload, "message") ??
        "STT error";
      this.cfg.onEvent({ type: "error", message, retriable: true });
      return;
    }

    if (type === "events") {
      const signal = pickStr(payload, "signal_type");
      if (signal === "START_SPEECH") this.cfg.onEvent({ type: "vad", speaking: true });
      if (signal === "END_SPEECH") this.cfg.onEvent({ type: "vad", speaking: false });
      return;
    }

    const lang =
      pickStr(payload, "language_code") ??
      pickStr(payload, "detected_language") ??
      pickStr(payload, "language");
    if (lang) this.cfg.onEvent({ type: "language", code: lang });

    const text = pickStr(payload, "transcript") ?? pickStr(payload, "text");
    if (text === undefined) return;

    // Saaras v3 streaming emits finals on type=data; treat unknown as final.
    const isFinal =
      type === "data" ||
      toBool(firstOf(payload, ["is_final", "final"])) ||
      pickStr(payload, "event") === "final";

    this.cfg.onEvent(
      isFinal
        ? {
            type: "final",
            text,
            language: lang,
            startMs: toNum(firstOf(payload, ["start_time_ms", "start_ms", "start"])),
            endMs: toNum(firstOf(payload, ["end_time_ms", "end_ms", "end"])),
          }
        : { type: "partial", text, language: lang },
    );
  }
}

function encodeAudioMessage(pcm: ArrayBuffer): string {
  const wav = pcmToWav(new Uint8Array(pcm), 16_000);
  const data = bytesToBase64(wav);
  return JSON.stringify({
    audio: {
      data,
      sample_rate: "16000",
      encoding: "audio/wav",
    },
  });
}

/** Minimal mono 16-bit PCM WAV wrapper for a raw s16le chunk. */
function pcmToWav(pcm: Uint8Array, sampleRate: number): Uint8Array {
  const header = new ArrayBuffer(44);
  const view = new DataView(header);
  const writeStr = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };
  writeStr(0, "RIFF");
  view.setUint32(4, 36 + pcm.length, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, "data");
  view.setUint32(40, pcm.length, true);

  const out = new Uint8Array(44 + pcm.length);
  out.set(new Uint8Array(header), 0);
  out.set(pcm, 44);
  return out;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function pickStr(msg: Record<string, unknown>, key: string): string | undefined {
  const v = msg[key];
  return typeof v === "string" && v.length > 0 ? v : undefined;
}
function firstOf(msg: Record<string, unknown>, keys: string[]): unknown {
  for (const k of keys) if (msg[k] !== undefined) return msg[k];
  return undefined;
}
function toBool(v: unknown): boolean {
  return v === true || v === "true" || v === 1;
}
function toNum(v: unknown): number | undefined {
  if (v === undefined || v === null) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

// ── Mock stream ──────────────────────────────────────────────────────────────

export interface ScriptedUtterance {
  atMs: number;
  text: string;
  language?: string;
  final?: boolean;
}

export class MockSttStream implements LiveSttStream {
  private timers: ReturnType<typeof setTimeout>[] = [];
  private startedAt = 0;

  constructor(
    private readonly script: ScriptedUtterance[],
    private readonly onEvent: (e: SttEvent) => void,
    private readonly speed = 1,
  ) {}

  async start(): Promise<void> {
    this.startedAt = Date.now();
    this.onEvent({ type: "open" });
    const lang = this.script[0]?.language;
    if (lang) this.onEvent({ type: "language", code: lang });
    for (const u of this.script) {
      this.timers.push(
        setTimeout(() => {
          this.onEvent({ type: "vad", speaking: true });
          this.onEvent(
            u.final === false
              ? { type: "partial", text: u.text, language: u.language }
              : {
                  type: "final",
                  text: u.text,
                  language: u.language,
                  startMs: u.atMs,
                  endMs: u.atMs + 1500,
                },
          );
          this.onEvent({ type: "vad", speaking: false });
        }, u.atMs / this.speed),
      );
    }
  }

  sendAudio(): void {}
  async finish(): Promise<void> {
    this.close();
  }
  close(): void {
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
    this.onEvent({ type: "close" });
  }
  elapsedMs(): number {
    return this.startedAt ? Date.now() - this.startedAt : 0;
  }
}
