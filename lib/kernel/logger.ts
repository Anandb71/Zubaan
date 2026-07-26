/**
 * Structured JSON logging with automatic secret redaction.
 *
 * One JSON object per line, so any aggregator can ingest it without a parser.
 * `child()` binds context once (call_id, product_id, resource) and it rides on
 * every subsequent line — which is how you trace one conversation through the
 * live path when three windows are in flight at once.
 *
 * Redaction is not optional and not a call-site responsibility: any key that
 * looks like a credential is masked anywhere in the context tree, so an
 * accidental `log.info("x", { config })` can never leak the Sarvam key.
 */

export type LogLevel = "debug" | "info" | "warn" | "error" | "silent";

const ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: 100,
};

const SECRET_KEY = /(key|secret|token|authorization|password|passwd|credential)/i;
const MAX_DEPTH = 6;

function redact(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) return "[truncated]";
  if (value instanceof Error) return { name: value.name, message: value.message };
  if (Array.isArray(value)) {
    return value.slice(0, 50).map((v) => redact(v, depth + 1));
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = SECRET_KEY.test(k) ? "[redacted]" : redact(v, depth + 1);
    }
    return out;
  }
  return value;
}

function resolveLevel(): LogLevel {
  const raw = (process.env.LOG_LEVEL ?? "").toLowerCase();
  if (raw in ORDER) return raw as LogLevel;
  if (process.env.NODE_ENV === "test") return "silent";
  return process.env.NODE_ENV === "production" ? "info" : "debug";
}

export interface Logger {
  debug(msg: string, ctx?: Record<string, unknown>): void;
  info(msg: string, ctx?: Record<string, unknown>): void;
  warn(msg: string, ctx?: Record<string, unknown>): void;
  error(msg: string, ctx?: Record<string, unknown>): void;
  child(bound: Record<string, unknown>): Logger;
}

function build(bound: Record<string, unknown>): Logger {
  const emit = (level: Exclude<LogLevel, "silent">, msg: string, ctx?: Record<string, unknown>) => {
    // Read the level per-call so tests and runtime env changes take effect.
    if (ORDER[level] < ORDER[resolveLevel()]) return;
    const line = {
      t: new Date().toISOString(),
      level,
      msg,
      ...(redact({ ...bound, ...ctx }) as Record<string, unknown>),
    };
    let text: string;
    try {
      text = JSON.stringify(line);
    } catch {
      text = JSON.stringify({ level: "error", msg: "log_serialize_failed", orig: msg });
    }
    if (level === "error" || level === "warn") process.stderr.write(text + "\n");
    else process.stdout.write(text + "\n");
  };

  return {
    debug: (m, c) => emit("debug", m, c),
    info: (m, c) => emit("info", m, c),
    warn: (m, c) => emit("warn", m, c),
    error: (m, c) => emit("error", m, c),
    child: (extra) => build({ ...bound, ...extra }),
  };
}

export const log: Logger = build({ svc: "zubaan" });

/** No-op logger for tests and hot paths where logging is not wanted. */
export const silentLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => silentLogger,
};
