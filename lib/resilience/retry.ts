/**
 * Retry a Result-returning operation while its error is retriable.
 *
 * Operates on Promise<Result<T>>, never on throwing functions, so the decision
 * comes from the typed `retriable` flag rather than string-matching an
 * exception. Honours upstream `retryAfterMs` when present.
 */

import { AppError, Clock, Logger, Result, silentLogger, systemClock } from "@/lib/kernel";
import { BackoffOptions, backoffDelay } from "./backoff";

export interface RetryOptions extends BackoffOptions {
  maxAttempts?: number;
  clock?: Clock;
  logger?: Logger;
  label?: string;
  /** Extra veto: return false to stop retrying even a retriable error. */
  shouldRetry?: (error: AppError, attempt: number) => boolean;
}

export async function withRetry<T>(
  fn: (attempt: number) => Promise<Result<T>>,
  opts: RetryOptions = {},
): Promise<Result<T>> {
  const maxAttempts = Math.max(1, opts.maxAttempts ?? 3);
  const clock = opts.clock ?? systemClock;
  const logger = opts.logger ?? silentLogger;

  let last!: Result<T>;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    last = await fn(attempt);
    if (last.ok) return last;

    const error = last.error;
    const isFinal = attempt === maxAttempts - 1;
    const allowed = error.retriable && (opts.shouldRetry?.(error, attempt) ?? true);

    if (isFinal || !allowed) return last;

    // Respect an explicit Retry-After, but never sleep less than our own backoff.
    const wait = Math.max(error.retryAfterMs ?? 0, backoffDelay(attempt, opts));
    logger.warn("retry.attempt", {
      label: opts.label,
      attempt: attempt + 1,
      of: maxAttempts,
      kind: error.kind,
      waitMs: wait,
    });
    await clock.sleep(wait);
  }

  return last;
}
