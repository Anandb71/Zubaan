/**
 * Concurrency-bounded task queue with backpressure.
 *
 * The live path checks each ~4s window against the product terms. A fast talker
 * produces overlapping windows; this caps in-flight model calls so we never blow
 * the 40 req/min budget, and sheds the OLDEST waiting window under sustained
 * overload — a stale flag is worse than no flag, and the newest speech is the
 * speech the customer is hearing right now.
 */

export interface QueueOptions {
  concurrency: number;
  /** Max queued (not yet started) tasks before shedding. */
  maxPending?: number;
  onShed?: (info: { pending: number }) => void;
}

interface Job<T> {
  run: () => Promise<T>;
  resolve: (v: T) => void;
  reject: (e: unknown) => void;
}

export class WorkQueue {
  private active = 0;
  private pending: Job<unknown>[] = [];
  private readonly concurrency: number;
  private readonly maxPending: number;
  private readonly onShed?: (info: { pending: number }) => void;

  constructor(opts: QueueOptions) {
    this.concurrency = Math.max(1, opts.concurrency);
    this.maxPending = opts.maxPending ?? Number.POSITIVE_INFINITY;
    this.onShed = opts.onShed;
  }

  stats(): { active: number; pending: number } {
    return { active: this.active, pending: this.pending.length };
  }

  add<T>(run: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.pending.push({ run, resolve, reject } as Job<unknown>);

      while (this.pending.length > this.maxPending) {
        const shed = this.pending.shift();
        this.onShed?.({ pending: this.pending.length });
        shed?.reject(new Error("queue: shed under backpressure"));
      }

      this.drain();
    });
  }

  /** Resolves when all active and pending work has settled. */
  async onIdle(): Promise<void> {
    while (this.active > 0 || this.pending.length > 0) {
      await new Promise((r) => setTimeout(r, 5));
    }
  }

  private drain(): void {
    while (this.active < this.concurrency && this.pending.length > 0) {
      const job = this.pending.shift()!;
      this.active += 1;
      Promise.resolve()
        .then(job.run)
        .then(job.resolve, job.reject)
        .finally(() => {
          this.active -= 1;
          this.drain();
        });
    }
  }
}
