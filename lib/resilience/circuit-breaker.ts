/**
 * Per-resource circuit breaker.
 *
 * When an upstream starts failing we stop hammering it: after N consecutive
 * qualifying failures the circuit OPENS and calls fail fast with `circuit_open`
 * for a cooldown. One trial call then probes recovery (HALF_OPEN); success
 * closes it, failure re-opens it.
 *
 * This protects our own latency budget as much as the upstream: a dead 105B
 * must not burn 30 seconds per request while the audit queue backs up.
 */

import { AppError, Clock, Errors, Logger, Result, err, silentLogger, systemClock } from "@/lib/kernel";

export type BreakerState = "closed" | "open" | "half_open";

export interface BreakerOptions {
  name: string;
  failureThreshold?: number;
  cooldownMs?: number;
  clock?: Clock;
  logger?: Logger;
}

export interface BreakerSnapshot {
  name: string;
  state: BreakerState;
  consecutiveFailures: number;
  openedAt: number | null;
}

export class CircuitBreaker {
  private state: BreakerState = "closed";
  private failures = 0;
  private openedAt: number | null = null;
  private probeInFlight = false;

  private readonly name: string;
  private readonly threshold: number;
  private readonly cooldownMs: number;
  private readonly clock: Clock;
  private readonly logger: Logger;

  constructor(opts: BreakerOptions) {
    this.name = opts.name;
    this.threshold = opts.failureThreshold ?? 5;
    this.cooldownMs = opts.cooldownMs ?? 15_000;
    this.clock = opts.clock ?? systemClock;
    this.logger = opts.logger ?? silentLogger;
  }

  /** Current state, accounting for an elapsed cooldown. */
  currentState(): BreakerState {
    if (
      this.state === "open" &&
      this.openedAt !== null &&
      this.clock.now() - this.openedAt >= this.cooldownMs
    ) {
      return "half_open";
    }
    return this.state;
  }

  snapshot(): BreakerSnapshot {
    return {
      name: this.name,
      state: this.currentState(),
      consecutiveFailures: this.failures,
      openedAt: this.openedAt,
    };
  }

  /** Wrap a Result-returning call with breaker logic. */
  async execute<T>(fn: () => Promise<Result<T>>): Promise<Result<T>> {
    const state = this.currentState();

    if (state === "open") {
      const elapsed = this.openedAt === null ? 0 : this.clock.now() - this.openedAt;
      return err(
        Errors.circuitOpen(`circuit '${this.name}' is open`, {
          retryAfterMs: Math.max(0, this.cooldownMs - elapsed),
          context: { breaker: this.name },
        }),
      );
    }

    if (state === "half_open") {
      // Admit exactly one probe; everyone else keeps failing fast.
      if (this.probeInFlight) {
        return err(
          Errors.circuitOpen(`circuit '${this.name}' is probing`, {
            retryAfterMs: this.cooldownMs,
            context: { breaker: this.name },
          }),
        );
      }
      this.probeInFlight = true;
      this.state = "half_open";
    }

    try {
      const result = await fn();
      if (result.ok) this.onSuccess();
      else if (this.countsAsFailure(result.error)) this.onFailure();
      return result;
    } finally {
      this.probeInFlight = false;
    }
  }

  /**
   * Only health-relevant failures trip the breaker. A 400 from a malformed
   * request means *we* are wrong, not that the upstream is down — counting it
   * would open the circuit on a bug and hide the real error.
   */
  private countsAsFailure(e: AppError): boolean {
    return (
      e.kind === "timeout" ||
      e.kind === "rate_limited" ||
      e.kind === "storage" ||
      (e.kind === "upstream" && e.retriable)
    );
  }

  private onSuccess(): void {
    if (this.state !== "closed") {
      this.logger.info("breaker.close", { breaker: this.name });
    }
    this.failures = 0;
    this.openedAt = null;
    this.state = "closed";
  }

  private onFailure(): void {
    this.failures += 1;
    // A failed half-open probe re-opens immediately; otherwise wait for N.
    if (this.state === "half_open" || this.failures >= this.threshold) {
      this.state = "open";
      this.openedAt = this.clock.now();
      this.logger.warn("breaker.open", {
        breaker: this.name,
        failures: this.failures,
        cooldownMs: this.cooldownMs,
      });
    }
  }

  /** Force-close. Used by the doctor script and tests. */
  reset(): void {
    this.state = "closed";
    this.failures = 0;
    this.openedAt = null;
    this.probeInFlight = false;
  }
}
