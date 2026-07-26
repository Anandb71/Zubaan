/**
 * Bulbul v3 text-to-speech. Verified live:
 *   POST /text-to-speech
 *   body     { text, target_language_code, model, speaker, speech_sample_rate }
 *   response { request_id, audios: [ <base64 wav> ] }
 *
 * Degradation rule: TTS failing must NEVER fail an audit. We return empty audio
 * with degraded=true and the UI delivers the text. The customer still learns
 * what they were promised versus what the document says — just by reading it.
 */

import { config } from "@/lib/config";
import { Errors, Result, err, ok } from "@/lib/kernel";
import { guard } from "@/lib/resilience";
import { toBcp47 } from "@/lib/i18n/languages";
import { postJson } from "./http";
import { pools, sarvamLog } from "./pools";
import { TtsRequest, TtsResult } from "./types";

interface RawTts {
  audios?: string[];
  request_id?: string;
}

const TEXT_ONLY: TtsResult = { audioBase64: "", mimeType: "audio/wav", degraded: true };

/** Bulbul caps input length; chunking is out of scope, so we clamp. */
const MAX_CHARS = 2_500;

export async function synthesize(req: TtsRequest): Promise<Result<TtsResult>> {
  const text = req.text.trim();
  if (!text) return ok(TEXT_ONLY);
  if (config.sarvam.mode === "mock") return ok(TEXT_ONLY);

  const body = {
    text: text.slice(0, MAX_CHARS),
    target_language_code: toBcp47(req.languageCode),
    model: config.sarvam.models.tts,
    speaker: req.speaker ?? config.sarvam.tts.speaker,
    speech_sample_rate: req.sampleRate ?? config.sarvam.tts.sampleRate,
  };

  return guard<TtsResult>(
    async (signal) => {
      const raw = await postJson<RawTts>("/text-to-speech", body, signal);
      if (!raw.ok) return raw;
      const audio = raw.value.audios?.[0];
      if (!audio) {
        return err(Errors.upstream("tts returned no audio", { retriable: true }));
      }
      return ok({ audioBase64: audio, mimeType: "audio/wav" as const, degraded: false });
    },
    {
      label: "tts",
      timeoutMs: config.sarvam.timeouts.tts,
      logger: sarvamLog,
      bucket: pools.tts.bucket,
      breaker: pools.tts.breaker,
      retry: { maxAttempts: 2 },
      fallback: () => ok(TEXT_ONLY),
    },
  );
}
