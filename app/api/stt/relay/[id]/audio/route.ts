import { NextResponse } from "next/server";

import {
  bearerToken,
  requireSameOrigin,
} from "@/lib/http/request-security";
import { httpStatusFor, toClientError } from "@/lib/kernel";
import { sttRelay } from "@/lib/sarvam/stt-relay";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_AUDIO_CHUNK_BYTES = 256 * 1024;

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(request: Request, context: RouteContext) {
  const origin = requireSameOrigin(request);
  if (!origin.ok) return errorResponse(origin.error);
  const token = bearerToken(request);
  if (!token.ok) return errorResponse(token.error);
  if (request.headers.get("content-type") !== "application/octet-stream") {
    return NextResponse.json(
      {
        error: {
          kind: "validation",
          message: "Audio chunks must use application/octet-stream",
        },
      },
      { status: 415 },
    );
  }
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (declaredLength > MAX_AUDIO_CHUNK_BYTES) {
    return NextResponse.json(
      { error: { kind: "validation", message: "Audio chunk is too large" } },
      { status: 413 },
    );
  }

  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_AUDIO_CHUNK_BYTES) {
    return NextResponse.json(
      { error: { kind: "validation", message: "Invalid audio chunk size" } },
      { status: 400 },
    );
  }
  const { id } = await context.params;
  const sent = sttRelay.sendAudio(id, token.value, bytes);
  if (!sent.ok) return errorResponse(sent.error);
  return new NextResponse(null, { status: 204 });
}

function errorResponse(error: Parameters<typeof toClientError>[0]) {
  return NextResponse.json(toClientError(error), {
    status: httpStatusFor(error),
  });
}
