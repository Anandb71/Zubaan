/**
 * Central, validated configuration.
 *
 * Two rules make "adaptable, runs anywhere" real:
 *
 *  1. Nothing here throws. A missing key downgrades a provider to a fallback
 *     MODE (sarvam -> "mock", storage -> "memory") instead of crashing boot.
 *     The repo builds, boots, and demos with ZERO credentials.
 *  2. Every model id, latency budget, and rate limit is config, not a magic
 *     number at a call site — so tuning under stage pressure is one env var,
 *     never a code hunt.
 *
 * All Sarvam values below were verified against the live API on 2026-07-26:
 *   GET  /v1/models          -> sarvam-30b, sarvam-105b
 *   POST /v1/chat/completions -> OpenAI-shaped, choices[0].message.content
 *   POST /text-to-speech      -> { request_id, audios: [base64 wav] }
 *   bulbul:v3 speakers        -> anushka is INVALID; priya is valid
 */

export type ProviderMode = "live" | "mock";
export type StorageMode = "supabase" | "memory";

const str = (name: string): string | undefined => {
  const v = process.env[name];
  return v && v.trim().length > 0 ? v.trim() : undefined;
};

const bool = (name: string, def: boolean): boolean => {
  const v = str(name)?.toLowerCase();
  if (v === undefined) return def;
  return v === "1" || v === "true" || v === "yes" || v === "on";
};

const int = (name: string, def: number): number => {
  const v = str(name);
  if (v === undefined) return def;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : def;
};

const json = (name: string): Record<string, unknown> => {
  const v = str(name);
  if (!v) return {};
  try {
    const p: unknown = JSON.parse(v);
    return p && typeof p === "object" && !Array.isArray(p)
      ? (p as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
};

const sarvamKey = str("SARVAM_API_KEY");
const supabaseUrl = str("NEXT_PUBLIC_SUPABASE_URL");
const supabaseAnon = str("NEXT_PUBLIC_SUPABASE_ANON_KEY");
const supabaseService = str("SUPABASE_SERVICE_ROLE_KEY");
const forceMock = bool("ZUBAAN_FORCE_MOCK", false);

export const config = Object.freeze({
  env: process.env.NODE_ENV ?? "development",

  sarvam: Object.freeze({
    mode: (sarvamKey && !forceMock ? "live" : "mock") as ProviderMode,
    apiKey: sarvamKey,
    baseUrl: str("SARVAM_BASE_URL") ?? "https://api.sarvam.ai",
    sttWsUrl: str("SARVAM_STT_WS_URL") ?? "wss://api.sarvam.ai/speech-to-text/ws",
    /** Doc AI path is optional; ingest structures raw text when unset. */
    docaiPath: str("SARVAM_DOCAI_PATH"),

    /** The deliberate two-model split, stated out loud in the demo. */
    models: Object.freeze({
      stt: str("SARVAM_STT_MODEL") ?? "saaras:v3",
      fast: str("SARVAM_FAST_MODEL") ?? "sarvam-30b", // live path
      reason: str("SARVAM_REASON_MODEL") ?? "sarvam-105b", // end-of-call path
      tts: str("SARVAM_TTS_MODEL") ?? "bulbul:v3",
      translate: str("SARVAM_TRANSLATE_MODEL") ?? "sarvam-translate:v1",
    }),

    /** Latency budgets (ms). A live flag must render inside 2s end to end. */
    timeouts: Object.freeze({
      fast: int("SARVAM_TIMEOUT_FAST_MS", 3_500),
      reason: int("SARVAM_TIMEOUT_REASON_MS", 45_000),
      tts: int("SARVAM_TIMEOUT_TTS_MS", 25_000),
      translate: int("SARVAM_TIMEOUT_TRANSLATE_MS", 15_000),
      docai: int("SARVAM_TIMEOUT_DOCAI_MS", 60_000),
    }),

    /** Published limits. Changing these changes pacing only. */
    limits: Object.freeze({
      sttConcurrent: int("SARVAM_LIMIT_STT_CONCURRENT", 20),
      chatPerMin: int("SARVAM_LIMIT_CHAT_PER_MIN", 40),
      ttsPerMin: int("SARVAM_LIMIT_TTS_PER_MIN", 30),
    }),

    tts: Object.freeze({
      sampleRate: int("SARVAM_TTS_SAMPLE_RATE", 24_000),
      /** Verified-valid bulbul:v3 speaker; calm and neutral. */
      speaker: str("SARVAM_TTS_SPEAKER") ?? "priya",
    }),

    /** Escape hatch for extra chat params (e.g. reasoning controls). */
    chatExtra: Object.freeze(json("SARVAM_CHAT_EXTRA")),
  }),

  storage: Object.freeze({
    mode: (supabaseUrl && supabaseService ? "supabase" : "memory") as StorageMode,
    url: supabaseUrl,
    anonKey: supabaseAnon,
    serviceKey: supabaseService,
    /** Snapshot path so in-memory dev data survives a restart. */
    snapshotPath: str("ZUBAAN_STORE_PATH") ?? ".data/store.json",
  }),

  pipeline: Object.freeze({
    /** Buffer finalized utterances into windows — the batching that keeps
     *  us under 40 req/min. Mandatory: never call the model per utterance. */
    windowMs: int("ZUBAAN_WINDOW_MS", 4_000),
    /** Cap in-flight fast checks so a fast talker can't blow the budget. */
    liveConcurrency: int("ZUBAAN_LIVE_CONCURRENCY", 3),
    /** Shed windows beyond this backlog; newest speech wins. */
    maxPendingWindows: int("ZUBAAN_MAX_PENDING_WINDOWS", 4),
    /** Few-shot examples pulled from confirmed feedback per product+language. */
    maxFewShot: int("ZUBAAN_MAX_FEWSHOT", 4),
  }),

  features: Object.freeze({
    /** Demo fixtures are explicit and never enabled in production by default. */
    demoMode: bool("ZUBAAN_DEMO_MODE", process.env.NODE_ENV !== "production"),
    /** Learn from human confirmations and feed them back as few-shot. */
    selfLearning: bool("ZUBAAN_SELF_LEARNING", true),
    /** Run the deterministic engine alongside the model and merge findings. */
    heuristicCrossCheck: bool("ZUBAAN_HEURISTIC_CROSSCHECK", true),
    /** Translate the audit into the customer's language before TTS. */
    translateAudit: bool("ZUBAAN_TRANSLATE_AUDIT", true),
  }),
});

export type Config = typeof config;

export interface Capability {
  name: string;
  status: "live" | "degraded" | "off";
  detail: string;
}

/**
 * What the system can actually do right now. Surfaced at /api/health and by the
 * doctor script so a failure on stage is diagnosed in one glance.
 */
export function capabilities(): Capability[] {
  const s = config.sarvam;
  const live = s.mode === "live";
  return [
    {
      name: "transcription",
      status: live ? "live" : "degraded",
      detail: live
        ? `${s.models.stt} streaming, codemix, auto-detect`
        : "mock: scripted transcript replay",
    },
    {
      name: "contradiction_check",
      status: live ? "live" : "degraded",
      detail: live
        ? `${s.models.fast} on the live path`
        : "deterministic heuristic engine only",
    },
    {
      name: "omission_audit",
      status: live ? "live" : "degraded",
      detail: live
        ? `${s.models.reason} at end of call`
        : "deterministic disclosure diff only",
    },
    {
      name: "voice_audit",
      status: live ? "live" : "degraded",
      detail: live ? `${s.models.tts} @ ${s.tts.sampleRate}Hz` : "text-only delivery",
    },
    {
      name: "storage",
      status: config.storage.mode === "supabase" ? "live" : "degraded",
      detail:
        config.storage.mode === "supabase"
          ? "supabase postgres + realtime"
          : "in-memory store with disk snapshot",
    },
    {
      name: "self_learning",
      status: config.features.selfLearning ? "live" : "off",
      detail: config.features.selfLearning
        ? `confirmed examples injected as few-shot (max ${config.pipeline.maxFewShot})`
        : "disabled",
    },
  ];
}
