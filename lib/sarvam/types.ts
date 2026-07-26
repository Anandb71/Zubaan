/** Provider-shaped types for the Sarvam facade. */

export type ModelTier = "fast" | "reason";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatOptions {
  tier: ModelTier;
  temperature?: number;
  maxTokens?: number;
}

export interface ChatResult {
  content: string;
  model: string;
  latencyMs: number;
}

export interface TtsRequest {
  text: string;
  languageCode: string;
  speaker?: string;
  sampleRate?: number;
}

export interface TtsResult {
  /** Base64 WAV. Empty when TTS degraded to text-only delivery. */
  audioBase64: string;
  mimeType: "audio/wav";
  degraded: boolean;
}

export interface TranslateRequest {
  text: string;
  sourceLanguage: string; // "auto" to detect
  targetLanguage: string;
}

export interface TranslateResult {
  text: string;
  /** True when the text was passed through untranslated as a fallback. */
  degraded: boolean;
}

// ── Streaming STT ────────────────────────────────────────────────────────────

export type SttEvent =
  | { type: "open" }
  | { type: "partial"; text: string; language?: string }
  | { type: "final"; text: string; language?: string; startMs?: number; endMs?: number }
  | { type: "vad"; speaking: boolean }
  | { type: "language"; code: string }
  | { type: "error"; message: string; retriable: boolean }
  | { type: "reconnecting"; attempt: number }
  | { type: "close"; code?: number };

export interface SttStreamOptions {
  /** BCP-47 code, or "unknown" for auto-detect. */
  languageCode?: string;
  mode?: "codemix" | "translate" | "transcribe";
  highVadSensitivity?: boolean;
  vadSignals?: boolean;
}
