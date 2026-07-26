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
import { parseSttMessage } from "@/lib/sarvam/stt-events";
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
    for (const event of parseSttMessage(data)) this.cfg.onEvent(event);
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

export interface RelaySttClientConfig {
  onEvent: (event: SttEvent) => void;
  endpoint?: string;
  maxBufferedFrames?: number;
  uploadIntervalMs?: number;
}

interface RelayHandle {
  id: string;
  token: string;
  expiresAt: number;
}

interface RelayPollResponse {
  events?: { sequence: number; event: SttEvent }[];
  state?: "connecting" | "open" | "closed" | "error";
  nextSequence?: number;
}

/**
 * Same-origin STT client. Audio goes to Zubaan's relay; the Sarvam API key
 * never enters the browser, URLs, logs, or reconnect state.
 */
export class RelaySttStream implements LiveSttStream {
  private readonly endpoint: string;
  private readonly maxBuffered: number;
  private readonly uploadIntervalMs: number;
  private handle: RelayHandle | null = null;
  private frames: Uint8Array[] = [];
  private uploadTimer: ReturnType<typeof setTimeout> | null = null;
  private writeChain: Promise<void> = Promise.resolve();
  private closedByUser = false;
  private lastSequence = 0;

  constructor(private readonly cfg: RelaySttClientConfig) {
    this.endpoint = cfg.endpoint ?? "/api/stt/relay";
    this.maxBuffered = cfg.maxBufferedFrames ?? 120;
    this.uploadIntervalMs = cfg.uploadIntervalMs ?? 240;
  }

  async start(): Promise<void> {
    this.closedByUser = false;
    this.lastSequence = 0;
    const response = await fetch(this.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    const payload = (await response.json()) as {
      session?: RelayHandle;
      error?: { message?: string };
    };
    if (!response.ok || !payload.session) {
      throw new Error(payload.error?.message ?? "Could not start secure STT relay");
    }
    this.handle = payload.session;
    void this.poll();
  }

  sendAudio(pcm: ArrayBuffer): void {
    if (this.closedByUser) return;
    this.frames.push(new Uint8Array(pcm.slice(0)));
    while (this.frames.length > this.maxBuffered) this.frames.shift();
    if (!this.uploadTimer) {
      this.uploadTimer = setTimeout(() => {
        this.uploadTimer = null;
        this.flushAudio();
      }, this.uploadIntervalMs);
    }
  }

  async finish(): Promise<void> {
    if (this.uploadTimer) {
      clearTimeout(this.uploadTimer);
      this.uploadTimer = null;
    }
    this.flushAudio();
    await this.writeChain;
    const handle = this.handle;
    if (handle) {
      await fetch(`${this.endpoint}/${encodeURIComponent(handle.id)}`, {
        method: "PATCH",
        headers: this.headers(handle),
      }).catch(() => undefined);
      await delay(800);
    }
    this.close();
  }

  close(): void {
    if (this.closedByUser) return;
    this.closedByUser = true;
    if (this.uploadTimer) clearTimeout(this.uploadTimer);
    this.uploadTimer = null;
    this.frames = [];
    const handle = this.handle;
    this.handle = null;
    if (handle) {
      void fetch(`${this.endpoint}/${encodeURIComponent(handle.id)}`, {
        method: "DELETE",
        headers: this.headers(handle),
        keepalive: true,
      }).catch(() => undefined);
    }
  }

  private flushAudio(): void {
    const handle = this.handle;
    if (!handle || this.frames.length === 0 || this.closedByUser) return;
    const frames = this.frames.splice(0, this.frames.length);
    const length = frames.reduce((total, frame) => total + frame.byteLength, 0);
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const frame of frames) {
      bytes.set(frame, offset);
      offset += frame.byteLength;
    }

    this.writeChain = this.writeChain
      .then(async () => {
        if (this.closedByUser) return;
        const response = await fetch(
          `${this.endpoint}/${encodeURIComponent(handle.id)}/audio`,
          {
            method: "POST",
            headers: {
              ...this.headers(handle),
              "Content-Type": "application/octet-stream",
            },
            body: bytes,
          },
        );
        if (!response.ok) {
          const payload = (await response.json().catch(() => null)) as {
            error?: { message?: string };
          } | null;
          this.cfg.onEvent({
            type: "error",
            message: payload?.error?.message ?? "Secure STT audio upload failed",
            retriable: response.status >= 500 || response.status === 429,
          });
        }
      })
      .catch(() => {
        this.cfg.onEvent({
          type: "error",
          message: "Secure STT audio upload could not reach the relay",
          retriable: true,
        });
      });
  }

  private async poll(): Promise<void> {
    while (!this.closedByUser) {
      const handle = this.handle;
      if (!handle) return;
      try {
        const response = await fetch(
          `${this.endpoint}/${encodeURIComponent(handle.id)}?after=${this.lastSequence}`,
          {
            headers: this.headers(handle),
            cache: "no-store",
          },
        );
        const payload = (await response.json()) as RelayPollResponse & {
          error?: { message?: string };
        };
        if (!response.ok) {
          this.cfg.onEvent({
            type: "error",
            message: payload.error?.message ?? "Secure STT event poll failed",
            retriable: response.status >= 500 || response.status === 429,
          });
          if (response.status === 403 || response.status === 404) return;
        } else {
          for (const envelope of payload.events ?? []) {
            this.lastSequence = Math.max(this.lastSequence, envelope.sequence);
            this.cfg.onEvent(envelope.event);
          }
          if (payload.state === "closed" || payload.state === "error") return;
        }
      } catch {
        this.cfg.onEvent({
          type: "error",
          message: "Secure STT relay temporarily unreachable",
          retriable: true,
        });
      }
      await delay(250);
    }
  }

  private headers(handle: RelayHandle): Record<string, string> {
    return { Authorization: `Bearer ${handle.token}` };
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
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
