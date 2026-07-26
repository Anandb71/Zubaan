/**
 * Server-side builder for a Saaras v3 streaming session.
 *
 * Browser cannot set WS headers, so the key rides in the query string.
 * Client fetches this URL from /api/stt/session — never from the bundle.
 */

import { config } from "@/lib/config";
import { Errors, Result, err, ok } from "@/lib/kernel";
import { SttStreamOptions } from "./types";

export interface SttSession {
  url: string;
  model: string;
  mode: string;
  expiresAt: number;
}

export function buildSttSession(opts: SttStreamOptions = {}): Result<SttSession> {
  if (config.sarvam.mode === "mock" || !config.sarvam.apiKey) {
    return err(Errors.degraded("STT is in mock mode; use the scripted stream"));
  }

  const mode = opts.mode ?? "codemix";
  // Official AsyncAPI uses hyphenated `language-code` and connection-level
  // sample_rate + input_audio_codec for raw PCM mic streams.
  const params = new URLSearchParams({
    model: config.sarvam.models.stt,
    "api-subscription-key": config.sarvam.apiKey,
    "language-code": opts.languageCode ?? "unknown",
    mode,
    sample_rate: "16000",
    input_audio_codec: "pcm_s16le",
    high_vad_sensitivity: String(opts.highVadSensitivity ?? true),
    vad_signals: String(opts.vadSignals ?? true),
    flush_signal: "true",
  });

  return ok({
    url: `${config.sarvam.sttWsUrl}?${params.toString()}`,
    model: config.sarvam.models.stt,
    mode,
    expiresAt: Date.now() + 50 * 60 * 1000,
  });
}
