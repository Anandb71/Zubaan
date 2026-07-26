import { NextResponse } from "next/server";

import {
  bearerToken,
  requireSameOrigin,
} from "@/lib/http/request-security";
import { httpStatusFor, toClientError } from "@/lib/kernel";
import { sttRelay } from "@/lib/sarvam/stt-relay";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(request: Request, context: RouteContext) {
  const token = bearerToken(request);
  if (!token.ok) return errorResponse(token.error);
  const { id } = await context.params;
  const afterRaw = new URL(request.url).searchParams.get("after") ?? "0";
  const after = Number.parseInt(afterRaw, 10);
  if (!Number.isInteger(after) || after < 0) {
    return NextResponse.json(
      { error: { kind: "validation", message: "after must be a non-negative integer" } },
      { status: 400 },
    );
  }
  const snapshot = sttRelay.events(id, token.value, after);
  if (!snapshot.ok) return errorResponse(snapshot.error);
  return NextResponse.json(snapshot.value, {
    headers: { "Cache-Control": "no-store" },
  });
}

export async function PATCH(request: Request, context: RouteContext) {
  const origin = requireSameOrigin(request);
  if (!origin.ok) return errorResponse(origin.error);
  const token = bearerToken(request);
  if (!token.ok) return errorResponse(token.error);
  const { id } = await context.params;
  const flushed = sttRelay.flush(id, token.value);
  if (!flushed.ok) return errorResponse(flushed.error);
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request, context: RouteContext) {
  const origin = requireSameOrigin(request);
  if (!origin.ok) return errorResponse(origin.error);
  const token = bearerToken(request);
  if (!token.ok) return errorResponse(token.error);
  const { id } = await context.params;
  const closed = sttRelay.close(id, token.value);
  if (!closed.ok) return errorResponse(closed.error);
  return new NextResponse(null, { status: 204 });
}

function errorResponse(error: Parameters<typeof toClientError>[0]) {
  return NextResponse.json(toClientError(error), {
    status: httpStatusFor(error),
  });
}
