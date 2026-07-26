/**
 * Doc AI Extract — optional document → text bridge.
 *
 * The PRD is explicit: "If Doc AI Extract fights you, keep terms_json hardcoded
 * and move on. The live loop is the demo." So this is best-effort by design.
 * When SARVAM_DOCAI_PATH is unset we return a `degraded` error and the ingest
 * pipeline structures whatever text it was given with the reasoning model.
 * The document path is never on the critical live loop.
 */

import { config } from "@/lib/config";
import { Errors, Result, err, ok } from "@/lib/kernel";
import { guard } from "@/lib/resilience";
import { postJson } from "./http";
import { pools, sarvamLog } from "./pools";

interface RawDoc {
  text?: string;
  content?: string;
  pages?: Array<{ text?: string }>;
}

export function docAiAvailable(): boolean {
  return config.sarvam.mode === "live" && Boolean(config.sarvam.docaiPath);
}

export async function extractDocumentText(
  fileBase64: string,
  mimeType = "application/pdf",
): Promise<Result<string>> {
  if (!docAiAvailable()) {
    return err(
      Errors.degraded("Doc AI Extract not configured; will structure raw text instead"),
    );
  }

  return guard<string>(
    async (signal) => {
      const raw = await postJson<RawDoc>(
        config.sarvam.docaiPath!,
        { document: fileBase64, mime_type: mimeType },
        signal,
      );
      if (!raw.ok) return raw;
      const text =
        raw.value.text ??
        raw.value.content ??
        raw.value.pages?.map((p) => p.text ?? "").join("\n");
      if (!text?.trim()) {
        return err(Errors.upstream("doc ai returned no text", { retriable: false }));
      }
      return ok(text);
    },
    {
      label: "docai",
      timeoutMs: config.sarvam.timeouts.docai,
      logger: sarvamLog,
      breaker: pools.docai.breaker,
      retry: { maxAttempts: 2 },
    },
  );
}
