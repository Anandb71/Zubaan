/**
 * Sarvam Translate.
 *   POST /translate
 *   body     { input, source_language_code, target_language_code, model }
 *   response { translated_text, request_id }
 *
 * Degradation rule: on failure, deliver the ORIGINAL text with degraded=true.
 * An audit the customer can read in the agent's language beats no audit.
 */

import { config } from "@/lib/config";
import { Errors, Result, err, ok } from "@/lib/kernel";
import { guard } from "@/lib/resilience";
import { toBcp47 } from "@/lib/i18n/languages";
import { postJson } from "./http";
import { pools, sarvamLog } from "./pools";
import { TranslateRequest, TranslateResult } from "./types";

interface RawTranslate {
  translated_text?: string;
  request_id?: string;
}

const MAX_CHARS = 4_000;

export async function translate(req: TranslateRequest): Promise<Result<TranslateResult>> {
  const text = req.text.trim();

  // No-op fast paths: nothing to translate, or already the target language.
  if (!text) return ok({ text: req.text, degraded: false });
  if (req.sourceLanguage !== "auto" && toBcp47(req.sourceLanguage) === toBcp47(req.targetLanguage)) {
    return ok({ text: req.text, degraded: false });
  }
  if (config.sarvam.mode === "mock") return ok({ text: req.text, degraded: true });

  const body = {
    input: text.slice(0, MAX_CHARS),
    source_language_code:
      req.sourceLanguage === "auto" ? "auto" : toBcp47(req.sourceLanguage),
    target_language_code: toBcp47(req.targetLanguage),
    model: config.sarvam.models.translate,
  };

  return guard<TranslateResult>(
    async (signal) => {
      const raw = await postJson<RawTranslate>("/translate", body, signal);
      if (!raw.ok) return raw;
      const out = raw.value.translated_text;
      if (!out) {
        return err(Errors.upstream("translate returned no text", { retriable: true }));
      }
      return ok({ text: out, degraded: false });
    },
    {
      label: "translate",
      timeoutMs: config.sarvam.timeouts.translate,
      logger: sarvamLog,
      bucket: pools.translate.bucket,
      breaker: pools.translate.breaker,
      retry: { maxAttempts: 2 },
      fallback: () => ok({ text: req.text, degraded: true }),
    },
  );
}
