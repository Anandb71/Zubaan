/**
 * Process-wide resilience singletons, one per Sarvam resource.
 *
 * These MUST be shared across callers to mean anything: a per-request breaker
 * can never trip, and a per-request bucket can never enforce a global 40/min.
 * In serverless they live for the lifetime of a warm instance, which is the
 * right granularity for pacing one node's share of the budget.
 */

import { config } from "@/lib/config";
import { log } from "@/lib/kernel";
import { CircuitBreaker, Semaphore, TokenBucket } from "@/lib/resilience";

export const sarvamLog = log.child({ mod: "sarvam" });

const breaker = (name: string) =>
  new CircuitBreaker({ name, logger: sarvamLog, failureThreshold: 5, cooldownMs: 15_000 });

export const pools = {
  chat: {
    // 30B and 105B share one 40 req/min chat budget.
    bucket: new TokenBucket(config.sarvam.limits.chatPerMin),
    breaker: breaker("sarvam.chat"),
  },
  tts: {
    bucket: new TokenBucket(config.sarvam.limits.ttsPerMin),
    breaker: breaker("sarvam.tts"),
  },
  translate: {
    bucket: new TokenBucket(config.sarvam.limits.chatPerMin),
    breaker: breaker("sarvam.translate"),
  },
  docai: { breaker: breaker("sarvam.docai") },
  stt: {
    semaphore: new Semaphore(config.sarvam.limits.sttConcurrent),
    breaker: breaker("sarvam.stt"),
  },
} as const;

/** Breaker + budget snapshot for /api/health. */
export function poolHealth() {
  return {
    chat: {
      ...pools.chat.breaker.snapshot(),
      tokensAvailable: pools.chat.bucket.available(),
    },
    tts: {
      ...pools.tts.breaker.snapshot(),
      tokensAvailable: pools.tts.bucket.available(),
    },
    translate: pools.translate.breaker.snapshot(),
    docai: pools.docai.breaker.snapshot(),
    stt: { ...pools.stt.breaker.snapshot(), ...pools.stt.semaphore.stats() },
  };
}
