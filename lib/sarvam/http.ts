/**
 * Authed HTTP to Sarvam, mapping every response into a typed Result.
 *
 * The error envelope (verified live) is:
 *   { "error": { "message", "code", "request_id" } }
 *
 * We translate status + envelope into an AppError whose `retriable` flag is
 * correct, so the resilience layer can act on the kind alone. The distinction
 * that matters most: 4xx means WE are wrong (never retry, never trip the
 * breaker); 5xx/429 means the upstream is struggling (retry, and count it).
 */

import { config } from "@/lib/config";
import { AppError, Errors, Result, err, ok } from "@/lib/kernel";

const AUTH_HEADER = "api-subscription-key";

interface SarvamErrorBody {
  error?: { message?: string; code?: string; request_id?: string };
}

export async function postJson<T>(
  path: string,
  body: unknown,
  signal: AbortSignal,
): Promise<Result<T>> {
  return request<T>(path, { method: "POST", body: JSON.stringify(body) }, signal);
}

export async function getJson<T>(path: string, signal: AbortSignal): Promise<Result<T>> {
  return request<T>(path, { method: "GET" }, signal);
}

async function request<T>(
  path: string,
  init: RequestInit,
  signal: AbortSignal,
): Promise<Result<T>> {
  const key = config.sarvam.apiKey;
  if (!key) return err(Errors.config("SARVAM_API_KEY is not set"));

  const url = path.startsWith("http") ? path : `${config.sarvam.baseUrl}${path}`;

  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      signal,
      headers: {
        [AUTH_HEADER]: key,
        "Content-Type": "application/json",
        Accept: "application/json",
        ...(init.headers ?? {}),
      },
    });
  } catch (cause) {
    if (cause instanceof Error && cause.name === "AbortError") {
      return err(Errors.timeout(`sarvam ${path} aborted`, { cause }));
    }
    return err(Errors.upstream(`sarvam ${path} network error`, { retriable: true, cause }));
  }

  if (!res.ok) return err(await mapError(path, res));

  try {
    return ok((await res.json()) as T);
  } catch (cause) {
    return err(Errors.upstream(`sarvam ${path} returned unparseable JSON`, { cause }));
  }
}

async function mapError(path: string, res: Response): Promise<AppError> {
  let message = res.statusText || `HTTP ${res.status}`;
  let code: string | undefined;
  try {
    const body = (await res.json()) as SarvamErrorBody;
    if (body.error?.message) message = body.error.message;
    code = body.error?.code;
  } catch {
    /* non-JSON body; keep statusText */
  }

  const context = { path, status: res.status, code };
  const label = `sarvam ${path}: ${message}`;

  if (res.status === 429) {
    return Errors.rateLimited(label, {
      status: 429,
      retryAfterMs: retryAfter(res),
      context,
    });
  }
  if (res.status === 408 || res.status >= 500) {
    return Errors.upstream(label, { status: res.status, retriable: true, context });
  }
  // 400/401/403/404/422: our request or our credentials. Retrying cannot help,
  // and counting it against the breaker would hide the real bug.
  return Errors.upstream(label, { status: res.status, retriable: false, context });
}

function retryAfter(res: Response): number | undefined {
  const h = res.headers.get("retry-after");
  if (!h) return undefined;
  const secs = Number(h);
  return Number.isFinite(secs) ? secs * 1000 : undefined;
}
