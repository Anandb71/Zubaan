/**
 * The single error taxonomy for the entire system.
 *
 * Design rule: a caller must be able to decide what to do — retry, degrade, or
 * surface — from the typed fields alone, never by matching on a message string.
 * That is why `retriable` is part of the type and not an inference.
 */

export type ErrorKind =
  | "config" // missing/invalid configuration
  | "validation" // input or model output failed a schema check
  | "not_found" // referenced entity does not exist
  | "conflict" // optimistic lock or immutable idempotency key disagreed
  | "forbidden" // caller's role may not see/do this
  | "rate_limited" // local or upstream throttle
  | "timeout" // exceeded its deadline
  | "circuit_open" // upstream presumed unhealthy; failing fast
  | "upstream" // provider returned an error
  | "storage" // persistence failed
  | "degraded" // ran in fallback mode; value is partial/synthetic
  | "internal"; // a bug we did not anticipate

export interface AppError {
  readonly kind: ErrorKind;
  readonly message: string;
  /** Could retrying this exact call plausibly succeed? */
  readonly retriable: boolean;
  /** Upstream HTTP status, when it came from an HTTP call. */
  readonly status?: number;
  /** Minimum delay before a retry (e.g. from Retry-After). */
  readonly retryAfterMs?: number;
  /** Structured log context. Never put secrets here. */
  readonly context?: Record<string, unknown>;
  /** Original thrown value. Never serialized to clients. */
  readonly cause?: unknown;
}

type Opts = Omit<Partial<AppError>, "kind" | "message">;

const make = (
  kind: ErrorKind,
  message: string,
  retriable: boolean,
  opts: Opts = {},
): AppError => ({ kind, message, retriable, ...opts });

export const Errors = {
  config: (m: string, o: Opts = {}) => make("config", m, false, o),
  validation: (m: string, o: Opts = {}) => make("validation", m, false, o),
  notFound: (m: string, o: Opts = {}) => make("not_found", m, false, o),
  conflict: (m: string, o: Opts = {}) => make("conflict", m, false, o),
  forbidden: (m: string, o: Opts = {}) => make("forbidden", m, false, o),
  rateLimited: (m: string, o: Opts = {}) => make("rate_limited", m, true, o),
  timeout: (m: string, o: Opts = {}) => make("timeout", m, true, o),
  circuitOpen: (m: string, o: Opts = {}) => make("circuit_open", m, true, o),
  upstream: (m: string, o: Opts = {}) => make("upstream", m, o.retriable ?? true, o),
  storage: (m: string, o: Opts = {}) => make("storage", m, o.retriable ?? true, o),
  degraded: (m: string, o: Opts = {}) => make("degraded", m, false, o),
  internal: (m: string, o: Opts = {}) => make("internal", m, false, o),
} as const;

export function isAppError(v: unknown): v is AppError {
  return (
    typeof v === "object" &&
    v !== null &&
    "kind" in v &&
    "message" in v &&
    "retriable" in v
  );
}

/** Coerce any thrown value into an AppError without losing information. */
export function fromThrown(cause: unknown, kind: ErrorKind = "internal"): AppError {
  if (isAppError(cause)) return cause;
  const message = cause instanceof Error ? cause.message : String(cause);
  return make(kind, message, kind !== "config" && kind !== "validation", { cause });
}

/** HTTP status for an API response. */
export function httpStatusFor(e: AppError): number {
  if (e.status && e.status >= 400) return e.status;
  switch (e.kind) {
    case "validation":
      return 400;
    case "forbidden":
      return 403;
    case "not_found":
      return 404;
    case "conflict":
      return 409;
    case "rate_limited":
      return 429;
    case "timeout":
      return 504;
    case "circuit_open":
    case "degraded":
      return 503;
    case "config":
    case "internal":
    case "storage":
    case "upstream":
      return 500;
  }
}

/** Client-safe projection — drops `cause` and `context`. */
export function toClientError(e: AppError): { error: { kind: ErrorKind; message: string } } {
  return { error: { kind: e.kind, message: e.message } };
}
