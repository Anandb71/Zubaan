import { err, Errors, ok, type Result } from "@/lib/kernel";

export function requireSameOrigin(request: Request): Result<void> {
  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") {
    return err(Errors.forbidden("Cross-origin request rejected"));
  }
  if (origin && origin !== new URL(request.url).origin) {
    return err(Errors.forbidden("Origin mismatch"));
  }
  return ok(undefined);
}

export function bearerToken(request: Request): Result<string> {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) {
    return err(Errors.forbidden("Missing relay capability"));
  }
  const token = authorization.slice("Bearer ".length).trim();
  if (!token) return err(Errors.forbidden("Missing relay capability"));
  return ok(token);
}
