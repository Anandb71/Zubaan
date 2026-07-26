/**
 * Exponential backoff with full jitter.
 *
 * Full jitter — delay = random(0, base * factor^attempt) — is chosen over fixed
 * or equal jitter because Zubaan fans several 4-second windows at the same
 * upstream simultaneously. Without decorrelating the sleeps, every retry storm
 * re-collides on the same tick and the throttle never clears.
 *
 * `random` is injectable so tests can assert exact bounds.
 */

export interface BackoffOptions {
  baseMs?: number;
  maxMs?: number;
  factor?: number;
  random?: () => number;
}

const DEFAULTS = { baseMs: 250, maxMs: 8_000, factor: 2 } as const;

/** Sleep (ms) before retry attempt `attempt` (0-indexed). */
export function backoffDelay(attempt: number, opts: BackoffOptions = {}): number {
  const baseMs = opts.baseMs ?? DEFAULTS.baseMs;
  const maxMs = opts.maxMs ?? DEFAULTS.maxMs;
  const factor = opts.factor ?? DEFAULTS.factor;
  const rand = opts.random ?? Math.random;

  const ceiling = Math.min(maxMs, baseMs * Math.pow(factor, Math.max(0, attempt)));
  return Math.floor(rand() * ceiling);
}

/** The un-jittered ceiling for a given attempt — useful for assertions/logs. */
export function backoffCeiling(attempt: number, opts: BackoffOptions = {}): number {
  const baseMs = opts.baseMs ?? DEFAULTS.baseMs;
  const maxMs = opts.maxMs ?? DEFAULTS.maxMs;
  const factor = opts.factor ?? DEFAULTS.factor;
  return Math.min(maxMs, baseMs * Math.pow(factor, Math.max(0, attempt)));
}
