import "server-only";

import { randomBytes, timingSafeEqual } from "node:crypto";

import { buildSttSession } from "@/lib/sarvam/stt";
import { parseSttMessage } from "@/lib/sarvam/stt-events";
import type { SttEvent, SttStreamOptions } from "@/lib/sarvam/types";
import { err, Errors, log, ok, type Result, uuid } from "@/lib/kernel";

const relayLog = log.child({ mod: "sarvam.stt-relay" });
const MAX_ACTIVE_SESSIONS = 8;
const MAX_SESSION_AGE_MS = 20 * 60 * 1000;
const MAX_AUDIO_CHUNK_BYTES = 256 * 1024;
const MAX_BUFFERED_EVENTS = 256;
const OPEN_TIMEOUT_MS = 8_000;

export type RelaySessionState = "connecting" | "open" | "closed" | "error";

export interface RelayEventEnvelope {
  sequence: number;
  event: SttEvent;
}

export interface RelaySessionHandle {
  id: string;
  token: string;
  expiresAt: number;
}

interface RelaySnapshot {
  events: RelayEventEnvelope[];
  state: RelaySessionState;
  nextSequence: number;
}

class RelaySession {
  readonly id = uuid();
  readonly token = randomBytes(24).toString("base64url");
  readonly createdAt = Date.now();
  readonly expiresAt = this.createdAt + MAX_SESSION_AGE_MS;

  state: RelaySessionState = "connecting";
  audioBytes = 0;
  terminalAt: number | undefined;
  private sequence = 0;
  private readonly events: RelayEventEnvelope[] = [];

  constructor(private readonly socket: WebSocket) {
    socket.onmessage = (message) => {
      const text = messageText(message.data);
      for (const event of parseSttMessage(text)) this.push(event);
    };
    socket.onerror = () => {
      this.state = "error";
      this.terminalAt = Date.now();
      this.push({ type: "error", message: "STT relay upstream error", retriable: true });
    };
    socket.onclose = (event) => {
      this.state = this.state === "error" ? "error" : "closed";
      this.terminalAt ??= Date.now();
      this.push({ type: "close", code: event.code });
    };
  }

  markOpen(): void {
    this.state = "open";
    this.push({ type: "open" });
  }

  authorize(candidate: string): boolean {
    try {
      const expected = Buffer.from(this.token);
      const actual = Buffer.from(candidate);
      return expected.length === actual.length && timingSafeEqual(expected, actual);
    } catch {
      return false;
    }
  }

  sendAudio(pcm: Uint8Array): Result<void> {
    if (this.state !== "open" || this.socket.readyState !== WebSocket.OPEN) {
      return err(Errors.upstream("STT relay session is not open", { retriable: true }));
    }
    if (pcm.byteLength === 0 || pcm.byteLength > MAX_AUDIO_CHUNK_BYTES) {
      return err(
        Errors.validation(
          `Audio chunk must contain 1-${MAX_AUDIO_CHUNK_BYTES} bytes`,
        ),
      );
    }
    try {
      this.socket.send(encodeAudioMessage(pcm));
      this.audioBytes += pcm.byteLength;
      return ok(undefined);
    } catch (cause) {
      return err(Errors.upstream("Could not send audio upstream", { cause }));
    }
  }

  flush(): Result<void> {
    if (this.state !== "open" || this.socket.readyState !== WebSocket.OPEN) {
      return err(Errors.upstream("STT relay session is not open", { retriable: true }));
    }
    try {
      this.socket.send(JSON.stringify({ type: "flush" }));
      return ok(undefined);
    } catch (cause) {
      return err(Errors.upstream("Could not flush STT relay", { cause }));
    }
  }

  snapshot(afterSequence: number): RelaySnapshot {
    return {
      events: this.events
        .filter((item) => item.sequence > afterSequence)
        .map((item) => structuredClone(item)),
      state: this.state,
      nextSequence: this.sequence,
    };
  }

  close(code = 1000, reason = "client closed"): void {
    if (this.state === "closed") return;
    this.state = "closed";
    this.terminalAt = Date.now();
    try {
      this.socket.close(code, reason);
    } catch {
      // The socket may already have failed.
    }
  }

  private push(event: SttEvent): void {
    this.sequence += 1;
    this.events.push({ sequence: this.sequence, event });
    if (this.events.length > MAX_BUFFERED_EVENTS) this.events.shift();
  }
}

class SttRelayManager {
  private readonly sessions = new Map<string, RelaySession>();
  private opening = 0;
  private totalCreated = 0;
  private totalAudioBytes = 0;
  private totalErrors = 0;

  async create(options: SttStreamOptions = {}): Promise<Result<RelaySessionHandle>> {
    this.cleanup();
    if (this.sessions.size + this.opening >= MAX_ACTIVE_SESSIONS) {
      return err(
        Errors.rateLimited("STT relay capacity reached", {
          retryAfterMs: 2_000,
        }),
      );
    }

    const upstream = buildSttSession(options);
    if (!upstream.ok) return upstream;

    this.opening += 1;
    try {
      const socket = new WebSocket(upstream.value.url);
      const session = new RelaySession(socket);
      const opened = await waitForOpen(socket);
      if (!opened.ok) {
        session.close(1011, "upstream open failed");
        this.totalErrors += 1;
        return opened;
      }
      session.markOpen();
      this.sessions.set(session.id, session);
      this.totalCreated += 1;
      relayLog.info("STT relay session opened", { sessionId: session.id });
      return ok({
        id: session.id,
        token: session.token,
        expiresAt: session.expiresAt,
      });
    } finally {
      this.opening -= 1;
    }
  }

  sendAudio(id: string, token: string, bytes: Uint8Array): Result<void> {
    const session = this.authorized(id, token);
    if (!session.ok) return session;
    const result = session.value.sendAudio(bytes);
    if (result.ok) this.totalAudioBytes += bytes.byteLength;
    else this.totalErrors += 1;
    return result;
  }

  flush(id: string, token: string): Result<void> {
    const session = this.authorized(id, token);
    if (!session.ok) return session;
    return session.value.flush();
  }

  events(id: string, token: string, afterSequence: number): Result<RelaySnapshot> {
    const session = this.authorized(id, token);
    if (!session.ok) return session;
    return ok(session.value.snapshot(afterSequence));
  }

  close(id: string, token: string): Result<void> {
    const session = this.authorized(id, token);
    if (!session.ok) return session;
    session.value.close();
    this.sessions.delete(id);
    return ok(undefined);
  }

  health(): Record<string, number> {
    this.cleanup();
    return {
      active: this.sessions.size,
      opening: this.opening,
      capacity: MAX_ACTIVE_SESSIONS,
      totalCreated: this.totalCreated,
      totalAudioBytes: this.totalAudioBytes,
      totalErrors: this.totalErrors,
    };
  }

  private authorized(id: string, token: string): Result<RelaySession> {
    this.cleanup();
    const session = this.sessions.get(id);
    if (!session) return err(Errors.notFound("STT relay session not found"));
    if (!session.authorize(token)) {
      return err(Errors.forbidden("Invalid STT relay capability"));
    }
    return ok(session);
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [id, session] of this.sessions) {
      if (
        session.expiresAt <= now ||
        (session.terminalAt !== undefined && session.terminalAt + 30_000 <= now)
      ) {
        session.close(1000, "relay cleanup");
        this.sessions.delete(id);
      }
    }
  }
}

async function waitForOpen(socket: WebSocket): Promise<Result<void>> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: Result<void>) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(
      () => finish(err(Errors.timeout("Timed out opening upstream STT socket"))),
      OPEN_TIMEOUT_MS,
    );
    socket.onopen = () => finish(ok(undefined));
    const priorError = socket.onerror;
    socket.onerror = (event) => {
      priorError?.call(socket, event);
      finish(err(Errors.upstream("Upstream STT socket failed to open")));
    };
  });
}

function messageText(data: unknown): string | undefined {
  if (typeof data === "string") return data;
  if (data instanceof ArrayBuffer) return new TextDecoder().decode(data);
  if (ArrayBuffer.isView(data)) {
    return new TextDecoder().decode(
      new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
    );
  }
  return undefined;
}

function encodeAudioMessage(pcm: Uint8Array): string {
  const wav = pcmToWav(pcm, 16_000);
  return JSON.stringify({
    audio: {
      data: Buffer.from(wav).toString("base64"),
      sample_rate: "16000",
      encoding: "audio/wav",
    },
  });
}

function pcmToWav(pcm: Uint8Array, sampleRate: number): Uint8Array {
  const output = new Uint8Array(44 + pcm.length);
  const view = new DataView(output.buffer);
  writeString(view, 0, "RIFF");
  view.setUint32(4, 36 + pcm.length, true);
  writeString(view, 8, "WAVE");
  writeString(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(view, 36, "data");
  view.setUint32(40, pcm.length, true);
  output.set(pcm, 44);
  return output;
}

function writeString(view: DataView, offset: number, value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index));
  }
}

declare global {
  var __zubaanSttRelay: SttRelayManager | undefined;
}

export const sttRelay =
  globalThis.__zubaanSttRelay ?? new SttRelayManager();

if (process.env.NODE_ENV !== "production") {
  globalThis.__zubaanSttRelay = sttRelay;
}
