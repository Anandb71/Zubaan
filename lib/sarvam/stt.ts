/**
 * Server-side builder for a Saaras v3 streaming session.
 *
 * Upstream auth is the `api-subscription-key` header on the WebSocket upgrade.
 * Query-string credentials are rejected (403). The secure relay holds the key
 * server-side; browsers never receive this URL or credential.
 */

import { config } from "@/lib/config";
import { Errors, Result, err, ok } from "@/lib/kernel";
import { SttStreamOptions } from "./types";

export interface SttSession {
  /** Upstream WebSocket URL without credentials. */
  url: string;
  /** Header value for api-subscription-key. Never return to the browser. */
  apiKey: string;
  model: string;
  mode: string;
  expiresAt: number;
}

export function buildSttSession(opts: SttStreamOptions = {}): Result<SttSession> {
  if (config.sarvam.mode === "mock" || !config.sarvam.apiKey) {
    return err(Errors.degraded("STT is in mock mode; use the scripted stream"));
  }

  const mode = opts.mode ?? "codemix";
  // Official AsyncAPI uses hyphenated `language-code`. Keep sample_rate /
  // codec optional — WAV-framed chunks work without connection-level PCM.
  const params = new URLSearchParams({
    model: config.sarvam.models.stt,
    "language-code": opts.languageCode ?? "unknown",
    mode,
    high_vad_sensitivity: String(opts.highVadSensitivity ?? true),
    vad_signals: String(opts.vadSignals ?? true),
    flush_signal: "true",
  });

  return ok({
    url: `${config.sarvam.sttWsUrl}?${params.toString()}`,
    apiKey: config.sarvam.apiKey,
    model: config.sarvam.models.stt,
    mode,
    expiresAt: Date.now() + 50 * 60 * 1000,
  });
}
