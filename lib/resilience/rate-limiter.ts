/**
 * Rate-limiting primitives that mirror Sarvam's published limits exactly:
 *
 *   STT WebSocket    20 concurrent   -> Semaphore(20)
 *   sarvam-30b/105b  40 req/min      -> TokenBucket(40/min)
 *   bulbul:v3 TTS    30 req/min      -> TokenBucket(30/min)
 *
 * "Respect these or the demo dies." We pace *before* sending, so a 429 is a
 * rare exception handled by retry — not the control loop.
 */

import { Clock, systemClock } from "@/lib/kernel";

/**
 * Continuous-refill token bucket. Refilling continuously (rather than resetting
 * each minute) smooths bursts instead of letting every caller pile onto the top
 * of the minute.
 */
export class TokenBucket {
  private tokens: number;
  private lastRefill: number;
  private readonly capacity: number;
  private readonly perMs: number;

  constructor(
    ratePerMinute: number,
    private readonly clock: Clock = systemClock,
    burst?: number,
  ) {
    this.capacity = burst ?? ratePerMinute;
    this.tokens = this.capacity;
    this.perMs = ratePerMinute / 60_000;
    this.lastRefill = clock.now();
  }

  private refill(): void {
    const now = this.clock.now();
    const elapsed = now - this.lastRefill;
    if (elapsed <= 0) return;
    this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.perMs);
    this.lastRefill = now;
  }

  /** Take a token if one is free, without waiting. */
  tryAcquire(): boolean {
    this.refill();
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return true;
    }
    return false;
  }

  /** ms until a token frees up (0 if one is available now). */
  msUntilAvailable(): number {
    this.refill();
    if (this.tokens >= 1) return 0;
    return Math.ceil((1 - this.tokens) / this.perMs);
  }

  available(): number {
    this.refill();
    return Math.floor(this.tokens);
  }

  /** Wait until a token frees, then take it. */
  async acquire(): Promise<void> {
    // Loop: another caller may take the refilled token before we wake.
    for (;;) {
      if (this.tryAcquire()) return;
      const wait = this.msUntilAvailable();
      await this.clock.sleep(Math.max(1, Math.min(wait, 250)));
    }
  }
}

/**
 * FIFO counting semaphore for concurrency limits. FIFO matters: without it a
 * sustained load can starve the oldest window, and a stale flag is a wrong flag.
 */
export class Semaphore {
  private permits: number;
  private readonly queue: Array<() => void> = [];

  constructor(permits: number) {
    this.permits = Math.max(1, permits);
  }

  stats(): { free: number; waiting: number } {
    return { free: this.permits, waiting: this.queue.length };
  }

  async acquire(): Promise<() => void> {
    if (this.permits > 0) {
      this.permits -= 1;
      return this.release();
    }
    await new Promise<void>((resolve) => this.queue.push(resolve));
    // The releaser hands the permit directly to us; do not decrement again.
    return this.release();
  }

  private release(): () => void {
    let done = false;
    return () => {
      if (done) return; // idempotent: a double release must not over-credit
      done = true;
      const next = this.queue.shift();
      if (next) {
        // Transfer the permit straight to the next waiter (stays reserved).
        next();
      } else {
        this.permits += 1;
      }
    };
  }
}
