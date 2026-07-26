/**
 * Result<T, E> — the return type of every fallible operation in Zubaan.
 *
 * We do not throw across module boundaries. Throwing erases types and pushes
 * every caller into try/catch; a Result makes failure a value the caller must
 * look at. That is the spine of "a fallback for any problem": degrading is just
 * another branch, not an exception handler bolted on afterwards.
 */

import { AppError, fromThrown } from "./errors";

export type Ok<T> = { readonly ok: true; readonly value: T };
export type Err<E> = { readonly ok: false; readonly error: E };
export type Result<T, E = AppError> = Ok<T> | Err<E>;

export const ok = <T>(value: T): Ok<T> => ({ ok: true, value });
export const err = <E>(error: E): Err<E> => ({ ok: false, error });

export const isOk = <T, E>(r: Result<T, E>): r is Ok<T> => r.ok;
export const isErr = <T, E>(r: Result<T, E>): r is Err<E> => !r.ok;

/** Value if Ok, else the fallback. The workhorse of graceful degradation. */
export const unwrapOr = <T, E>(r: Result<T, E>, fallback: T): T =>
  r.ok ? r.value : fallback;

export const unwrapOrElse = <T, E>(r: Result<T, E>, f: (e: E) => T): T =>
  r.ok ? r.value : f(r.error);

export const map = <T, U, E>(r: Result<T, E>, f: (v: T) => U): Result<U, E> =>
  r.ok ? ok(f(r.value)) : r;

export const mapErr = <T, E, F>(r: Result<T, E>, f: (e: E) => F): Result<T, F> =>
  r.ok ? r : err(f(r.error));

export const andThen = <T, U, E>(
  r: Result<T, E>,
  f: (v: T) => Result<U, E>,
): Result<U, E> => (r.ok ? f(r.value) : r);

/**
 * The one sanctioned bridge from throwing code (fetch, SDKs) into Result-land.
 */
export async function tryAsync<T>(
  fn: () => Promise<T>,
  onThrow: (cause: unknown) => AppError = (c) => fromThrown(c),
): Promise<Result<T>> {
  try {
    return ok(await fn());
  } catch (cause) {
    return err(onThrow(cause));
  }
}

export function trySync<T>(
  fn: () => T,
  onThrow: (cause: unknown) => AppError = (c) => fromThrown(c),
): Result<T> {
  try {
    return ok(fn());
  } catch (cause) {
    return err(onThrow(cause));
  }
}

/** Collect Results; the first Err short-circuits. */
export function all<T, E>(results: Result<T, E>[]): Result<T[], E> {
  const out: T[] = [];
  for (const r of results) {
    if (!r.ok) return r;
    out.push(r.value);
  }
  return ok(out);
}

/**
 * Settle every Result, separating successes from failures. Used where partial
 * progress is better than none — e.g. one failed window must not void a call.
 */
export function partition<T, E>(results: Result<T, E>[]): { values: T[]; errors: E[] } {
  const values: T[] = [];
  const errors: E[] = [];
  for (const r of results) {
    if (r.ok) values.push(r.value);
    else errors.push(r.error);
  }
  return { values, errors };
}
