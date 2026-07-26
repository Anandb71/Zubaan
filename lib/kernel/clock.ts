/**
 * Injectable clock.
 *
 * Rate limiters, circuit breakers, and backoff are all time-dependent. With a
 * real clock their tests would need real sleeps — slow and flaky. Every
 * time-aware component takes a Clock, so tests drive time deterministically and
 * a 15-second breaker cooldown is verified in microseconds.
 */

export interface Clock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

export const systemClock: Clock = {
  now: () => Date.now(),
  sleep: (ms) =>
    new Promise((resolve) => {
      const t = setTimeout(resolve, Math.max(0, ms));
      // Don't hold the process open purely for a pending sleep.
      if (typeof t === "object" && t && "unref" in t) {
        (t as unknown as { unref: () => void }).unref();
      }
    }),
};

/** Test clock: time only moves when you advance it; sleeps resolve on advance. */
export class FakeClock implements Clock {
  private current: number;
  private waiters: Array<{ at: number; resolve: () => void }> = [];

  constructor(start = 0) {
    this.current = start;
  }

  now(): number {
    return this.current;
  }

  sleep(ms: number): Promise<void> {
    if (ms <= 0) return Promise.resolve();
    return new Promise((resolve) => {
      this.waiters.push({ at: this.current + ms, resolve });
    });
  }

  /** Move time forward and release any sleeps that are now due. */
  async advance(ms: number): Promise<void> {
    this.current += ms;
    const due = this.waiters.filter((w) => w.at <= this.current);
    this.waiters = this.waiters.filter((w) => w.at > this.current);
    for (const w of due) w.resolve();
    // Let released continuations run before returning.
    await Promise.resolve();
    await Promise.resolve();
  }
}
