/**
 * `guard` — the single composition point for every external call.
 *
 * It layers the primitives in the only order that is correct:
 *
 *   retry(                              outermost: re-pace and re-probe
 *     semaphore  (concurrency budget)
 *       -> token bucket (per-minute budget)
 *         -> circuit breaker (fail fast when upstream is down)
 *           -> deadline (never hang past the latency budget)
 *             -> fn(signal)
 *   ) -> fallback                        last resort: a degraded, usable value
 *
 * Ordering rationale:
 *  - budgets are acquired INSIDE retry so each attempt re-paces itself;
 *  - the breaker sits inside the budgets so a fail-fast rejection doesn't burn
 *    a rate-limit token;
 *  - the deadline is innermost so it measures the upstream call only, not the
 *    time spent waiting politely in our own queue.
 *
 * Every Sarvam and Supabase call goes through here, so "a fallback for any
 * problem" is defined once and inherited everywhere.
 */

import {
  AppError,
  Clock,
  Errors,
  Logger,
  Result,
  err,
  fromThrown,
  silentLogger,
  systemClock,
} from "@/lib/kernel";
import { CircuitBreaker } from "./circuit-breaker";
import { Semaphore, TokenBucket } from "./rate-limiter";
import { RetryOptions, withRetry } from "./retry";

export interface GuardOptions<T> {
  label: string;
  timeoutMs: number;
  clock?: Clock;
  logger?: Logger;
  breaker?: CircuitBreaker;
  bucket?: TokenBucket;
  semaphore?: Semaphore;
  retry?: Omit<RetryOptions, "clock" | "logger" | "label">;
  /**
   * Produce a usable value when the call ultimately fails. Returning Ok here is
   * how the system keeps going — e.g. TTS down, deliver the audit as text.
   */
  fallback?: (error: AppError) => Result<T> | Promise<Result<T>>;
}

export async function guard<T>(
  fn: (signal: AbortSignal) => Promise<Result<T>>,
  opts: GuardOptions<T>,
): Promise<Result<T>> {
  const logger = opts.logger ?? silentLogger;
  const clock = opts.clock ?? systemClock;

  const result = await withRetry<T>(() => attempt(fn, opts), {
    ...opts.retry,
    clock,
    logger,
    label: opts.label,
  });

  if (result.ok) return result;
  if (!opts.fallback) return result;

  logger.warn("guard.fallback", {
    label: opts.label,
    kind: result.error.kind,
    message: result.error.message,
  });

  try {
    return await opts.fallback(result.error);
  } catch (cause) {
    return err(fromThrown(cause, "internal"));
  }
}

async function attempt<T>(
  fn: (signal: AbortSignal) => Promise<Result<T>>,
  opts: GuardOptions<T>,
): Promise<Result<T>> {
  // 1. Concurrency budget, held for the whole attempt.
  const release = opts.semaphore ? await opts.semaphore.acquire() : undefined;
  try {
    // 2. Per-minute budget: wait for a token rather than firing into a 429.
    if (opts.bucket) await opts.bucket.acquire();

    // 3 + 4. Breaker wraps the deadline-bounded call.
    const call = () => withDeadline(opts.label, opts.timeoutMs, fn);
    return opts.breaker ? await opts.breaker.execute(call) : await call();
  } finally {
    release?.();
  }
}

/** Race a Result-returning fn against a hard deadline, aborting the work. */
async function withDeadline<T>(
  label: string,
  ms: number,
  fn: (signal: AbortSignal) => Promise<Result<T>>,
): Promise<Result<T>> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;

  const deadline = new Promise<Result<T>>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve(
        err(Errors.timeout(`${label} exceeded ${ms}ms`, { context: { label, ms } })),
      );
    }, ms);
  });

  try {
    // fn may throw synchronously or reject; normalize either into a Result.
    const work = Promise.resolve()
      .then(() => fn(controller.signal))
      .catch((cause) => err(fromThrown(cause, "upstream")) as Result<T>);
    return await Promise.race([work, deadline]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
