/**
 * Chat completions — the two-model split the demo names out loud.
 *
 *   tier "fast"   -> sarvam-30b   live path, sub-2s flag budget
 *   tier "reason" -> sarvam-105b  end-of-call audit, deep reasoning
 *
 * Transport resilience is applied here once; callers add only their own domain
 * fallback (the deterministic engine) on top.
 *
 * Note from live verification: these models emit a `reasoning_content` field
 * alongside `content`. We read only `content` — chain-of-thought is never
 * parsed as an answer, and never shown to a user.
 */

import { config } from "@/lib/config";
import { Errors, Result, err, ok } from "@/lib/kernel";
import { guard } from "@/lib/resilience";
import { postJson } from "./http";
import { pools, sarvamLog } from "./pools";
import { ChatMessage, ChatOptions, ChatResult } from "./types";

interface RawChat {
  choices?: Array<{ message?: { content?: string | null } }>;
}

export function chatAvailable(): boolean {
  return config.sarvam.mode === "live";
}

export async function chat(
  messages: ChatMessage[],
  opts: ChatOptions,
): Promise<Result<ChatResult>> {
  if (!chatAvailable()) {
    return err(Errors.degraded("sarvam is in mock mode; no live chat"));
  }

  const reason = opts.tier === "reason";
  const model = reason ? config.sarvam.models.reason : config.sarvam.models.fast;
  const timeoutMs = reason ? config.sarvam.timeouts.reason : config.sarvam.timeouts.fast;

  const body: Record<string, unknown> = {
    model,
    messages,
    temperature: opts.temperature ?? 0,
    ...(opts.maxTokens ? { max_tokens: opts.maxTokens } : {}),
    ...config.sarvam.chatExtra,
  };

  const startedAt = Date.now();

  return guard<ChatResult>(
    async (signal) => {
      const raw = await postJson<RawChat>("/v1/chat/completions", body, signal);
      if (!raw.ok) return raw;

      const content = raw.value.choices?.[0]?.message?.content ?? "";
      if (!content.trim()) {
        // An empty completion is a transient upstream hiccup, worth one retry.
        return err(Errors.upstream(`empty completion from ${model}`, { retriable: true }));
      }
      return ok({ content, model, latencyMs: Date.now() - startedAt });
    },
    {
      label: `chat.${opts.tier}`,
      timeoutMs,
      logger: sarvamLog,
      bucket: pools.chat.bucket,
      breaker: pools.chat.breaker,
      // The live path gets one retry (latency budget); the audit path gets more.
      retry: { maxAttempts: reason ? 3 : 2 },
    },
  );
}

/**
 * Chat that must return JSON. Models occasionally wrap JSON in prose or fences
 * even when told not to, so we recover the object rather than failing the check.
 */
export async function chatJson<T>(
  messages: ChatMessage[],
  opts: ChatOptions,
  validate: (value: unknown) => Result<T>,
): Promise<Result<T>> {
  const res = await chat(messages, opts);
  if (!res.ok) return res;

  const parsed = extractJson(res.value.content);
  if (!parsed.ok) return parsed;

  return validate(parsed.value);
}

/** Pull the first valid JSON value out of a possibly-messy model response. */
export function extractJson(raw: string): Result<unknown> {
  const cleaned = raw.replace(/```(?:json)?/gi, "").replace(/```/g, "").trim();

  const direct = tryParse(cleaned);
  if (direct !== undefined) return ok(direct);

  // Scan for a balanced {...} or [...] block, respecting strings and escapes.
  const block = firstBalanced(cleaned);
  if (block) {
    const parsed = tryParse(block);
    if (parsed !== undefined) return ok(parsed);
  }

  return err(
    Errors.validation("model did not return parseable JSON", {
      context: { preview: cleaned.slice(0, 200) },
    }),
  );
}

function tryParse(s: string): unknown | undefined {
  if (!s) return undefined;
  try {
    return JSON.parse(s);
  } catch {
    return undefined;
  }
}

/** Find the first balanced JSON object/array, ignoring braces inside strings. */
function firstBalanced(s: string): string | null {
  const start = s.search(/[{[]/);
  if (start < 0) return null;

  const openCh = s[start]!;
  const closeCh = openCh === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < s.length; i++) {
    const ch = s[i]!;
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === openCh) depth += 1;
    else if (ch === closeCh) {
      depth -= 1;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  return null;
}
