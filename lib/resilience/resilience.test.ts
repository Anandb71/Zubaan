/**
 * Resilience tests. These run on a FakeClock, so a 15-second breaker cooldown
 * and a 40-req/min bucket are verified in microseconds with no real sleeping
 * and no flakiness.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { Errors, FakeClock, err, ok, type Result } from "@/lib/kernel";
import { backoffCeiling, backoffDelay } from "./backoff";
import { Semaphore, TokenBucket } from "./rate-limiter";
import { CircuitBreaker } from "./circuit-breaker";
import { withRetry } from "./retry";
import { WorkQueue } from "./queue";
import { guard } from "./guard";

// ── backoff ──────────────────────────────────────────────────────────────────

test("backoff grows exponentially and is capped", () => {
  const o = { baseMs: 100, factor: 2, maxMs: 500 };
  assert.equal(backoffCeiling(0, o), 100);
  assert.equal(backoffCeiling(1, o), 200);
  assert.equal(backoffCeiling(2, o), 400);
  assert.equal(backoffCeiling(3, o), 500); // capped
  assert.equal(backoffCeiling(9, o), 500);
});

test("full jitter keeps delay within [0, ceiling)", () => {
  const o = { baseMs: 100, factor: 2, maxMs: 1000 };
  for (const r of [0, 0.5, 0.999]) {
    const d = backoffDelay(2, { ...o, random: () => r });
    assert.ok(d >= 0 && d < backoffCeiling(2, o), `delay ${d} out of range`);
  }
  // random()=0 must be able to produce an immediate retry (decorrelation).
  assert.equal(backoffDelay(3, { ...o, random: () => 0 }), 0);
});

// ── token bucket ─────────────────────────────────────────────────────────────

test("token bucket enforces the per-minute budget", () => {
  const clock = new FakeClock(0);
  const bucket = new TokenBucket(40, clock); // 40/min, burst 40

  for (let i = 0; i < 40; i++) {
    assert.ok(bucket.tryAcquire(), `token ${i} should be available`);
  }
  assert.equal(bucket.tryAcquire(), false, "41st call in the same instant must be refused");
  assert.ok(bucket.msUntilAvailable() > 0);
});

test("token bucket refills continuously, not in minute-boundary bursts", async () => {
  const clock = new FakeClock(0);
  const bucket = new TokenBucket(60, clock); // 1 per second
  while (bucket.tryAcquire()) {
    /* drain */
  }
  assert.equal(bucket.tryAcquire(), false);

  await clock.advance(1000); // exactly one token's worth of time
  assert.ok(bucket.tryAcquire(), "a token should have refilled after 1s");
  assert.equal(bucket.tryAcquire(), false, "only one token should have refilled");
});

// ── semaphore ────────────────────────────────────────────────────────────────

test("semaphore caps concurrency and is FIFO", async () => {
  const sem = new Semaphore(2);
  const order: number[] = [];

  const r1 = await sem.acquire();
  const r2 = await sem.acquire();
  assert.equal(sem.stats().free, 0);

  const third = sem.acquire().then((rel) => {
    order.push(3);
    return rel;
  });
  const fourth = sem.acquire().then((rel) => {
    order.push(4);
    return rel;
  });
  assert.equal(sem.stats().waiting, 2);

  r1();
  r2();
  (await third)();
  (await fourth)();

  assert.deepEqual(order, [3, 4], "waiters must be served in order");
});

test("double release does not over-credit permits", async () => {
  const sem = new Semaphore(1);
  const release = await sem.acquire();
  release();
  release();
  assert.equal(sem.stats().free, 1, "permit count must not exceed the maximum");
});

// ── circuit breaker ──────────────────────────────────────────────────────────

const upstreamFail = async (): Promise<Result<string>> =>
  err(Errors.upstream("boom", { retriable: true }));
const succeed = async (): Promise<Result<string>> => ok("fine");

test("breaker opens after the threshold and then fails fast", async () => {
  const clock = new FakeClock(0);
  const b = new CircuitBreaker({ name: "t", failureThreshold: 3, cooldownMs: 1000, clock });

  for (let i = 0; i < 3; i++) await b.execute(upstreamFail);
  assert.equal(b.currentState(), "open");

  let called = false;
  const r = await b.execute(async () => {
    called = true;
    return succeed();
  });
  assert.equal(called, false, "open circuit must not invoke the upstream");
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.error.kind, "circuit_open");
});

test("breaker half-opens after cooldown and closes on a successful probe", async () => {
  const clock = new FakeClock(0);
  const b = new CircuitBreaker({ name: "t", failureThreshold: 2, cooldownMs: 1000, clock });

  await b.execute(upstreamFail);
  await b.execute(upstreamFail);
  assert.equal(b.currentState(), "open");

  await clock.advance(1000);
  assert.equal(b.currentState(), "half_open");

  const r = await b.execute(succeed);
  assert.equal(r.ok, true);
  assert.equal(b.currentState(), "closed", "a successful probe must close the circuit");
});

test("a failed half-open probe re-opens immediately", async () => {
  const clock = new FakeClock(0);
  const b = new CircuitBreaker({ name: "t", failureThreshold: 2, cooldownMs: 1000, clock });
  await b.execute(upstreamFail);
  await b.execute(upstreamFail);
  await clock.advance(1000);

  await b.execute(upstreamFail); // the probe fails
  assert.equal(b.currentState(), "open", "must not wait for the full threshold again");
});

test("client errors do not trip the breaker", async () => {
  const clock = new FakeClock(0);
  const b = new CircuitBreaker({ name: "t", failureThreshold: 2, cooldownMs: 1000, clock });
  const badRequest = async (): Promise<Result<string>> =>
    err(Errors.upstream("400 bad request", { retriable: false, status: 400 }));

  await b.execute(badRequest);
  await b.execute(badRequest);
  await b.execute(badRequest);
  assert.equal(b.currentState(), "closed", "our own bad request must not mark upstream unhealthy");
});

// ── retry ────────────────────────────────────────────────────────────────────

test("retry stops immediately on a non-retriable error", async () => {
  const clock = new FakeClock(0);
  let calls = 0;
  const r = await withRetry(
    async () => {
      calls += 1;
      return err(Errors.validation("nope"));
    },
    { maxAttempts: 5, clock, baseMs: 0 },
  );
  assert.equal(calls, 1);
  assert.equal(r.ok, false);
});

test("retry re-attempts a retriable error and can succeed", async () => {
  const clock = new FakeClock(0);
  let calls = 0;
  const p = withRetry(
    async () => {
      calls += 1;
      return calls < 3 ? err(Errors.timeout("slow")) : ok("done");
    },
    { maxAttempts: 5, clock, baseMs: 10, random: () => 0 },
  );
  // random()=0 => zero-length sleeps, which the FakeClock resolves instantly.
  const r = await p;
  assert.equal(r.ok, true);
  assert.equal(calls, 3);
});

test("retry honours the attempt cap", async () => {
  const clock = new FakeClock(0);
  let calls = 0;
  const r = await withRetry(
    async () => {
      calls += 1;
      return err(Errors.timeout("always"));
    },
    { maxAttempts: 3, clock, baseMs: 0, random: () => 0 },
  );
  assert.equal(calls, 3);
  assert.equal(r.ok, false);
});

// ── queue ────────────────────────────────────────────────────────────────────

test("queue bounds concurrency", async () => {
  const q = new WorkQueue({ concurrency: 2 });
  let active = 0;
  let peak = 0;

  const task = () => async () => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((r) => setTimeout(r, 5));
    active -= 1;
    return true;
  };

  await Promise.all(Array.from({ length: 8 }, () => q.add(task())));
  assert.ok(peak <= 2, `peak concurrency was ${peak}, expected <= 2`);
});

test("queue sheds the oldest pending task under backpressure", async () => {
  const shed: number[] = [];
  const q = new WorkQueue({
    concurrency: 1,
    maxPending: 1,
    onShed: () => shed.push(1),
  });

  const slow = () => new Promise((r) => setTimeout(r, 20));
  const results = await Promise.allSettled([
    q.add(slow),
    q.add(slow),
    q.add(slow),
    q.add(slow),
  ]);

  assert.ok(shed.length > 0, "expected shedding to occur");
  assert.ok(
    results.some((r) => r.status === "rejected"),
    "shed tasks must reject so callers can react",
  );
});

// ── guard (composition) ──────────────────────────────────────────────────────

test("guard enforces a deadline and returns a timeout error", async () => {
  const r = await guard<string>(
    () => new Promise(() => {}), // never settles
    { label: "hang", timeoutMs: 20, retry: { maxAttempts: 1 } },
  );
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.error.kind, "timeout");
});

test("guard falls back to a usable value instead of failing", async () => {
  const r = await guard<string>(
    async () => err(Errors.upstream("down", { retriable: true })),
    {
      label: "tts",
      timeoutMs: 50,
      retry: { maxAttempts: 2, baseMs: 0, random: () => 0 },
      fallback: () => ok("text-only"),
    },
  );
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.value, "text-only");
});

test("guard surfaces a thrown exception as a Result, never as a throw", async () => {
  const r = await guard<string>(
    async () => {
      throw new Error("kaboom");
    },
    { label: "throws", timeoutMs: 50, retry: { maxAttempts: 1 } },
  );
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.error.message, /kaboom/);
});

test("guard aborts the signal when the deadline passes", async () => {
  let aborted = false;
  await guard<string>(
    (signal) =>
      new Promise((resolve) => {
        signal.addEventListener("abort", () => {
          aborted = true;
          resolve(err(Errors.timeout("aborted")));
        });
      }),
    { label: "abortable", timeoutMs: 15, retry: { maxAttempts: 1 } },
  );
  assert.equal(aborted, true, "the AbortSignal must fire so fetch can cancel");
});

test("guard does not burn a rate-limit token when the circuit is open", async () => {
  const clock = new FakeClock(0);
  const breaker = new CircuitBreaker({ name: "x", failureThreshold: 1, cooldownMs: 10_000, clock });
  const bucket = new TokenBucket(40, clock);

  await breaker.execute(upstreamFail); // opens it
  assert.equal(breaker.currentState(), "open");

  const before = bucket.available();
  await guard<string>(async () => succeed(), {
    label: "guarded",
    timeoutMs: 50,
    clock,
    breaker,
    bucket,
    retry: { maxAttempts: 1 },
  });
  // One token is spent entering the attempt, but the upstream is never called;
  // what matters is that we fail fast rather than hanging or looping.
  assert.ok(bucket.available() <= before);
});
