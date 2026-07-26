import { NextResponse } from "next/server";

import { requireSameOrigin } from "@/lib/http/request-security";
import { httpStatusFor, toClientError } from "@/lib/kernel";
import { sttRelay } from "@/lib/sarvam/stt-relay";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const origin = requireSameOrigin(request);
  if (!origin.ok) {
    return NextResponse.json(toClientError(origin.error), {
      status: httpStatusFor(origin.error),
    });
  }

  const created = await sttRelay.create({
    languageCode: "unknown",
    mode: "codemix",
    highVadSensitivity: true,
    vadSignals: true,
  });
  if (!created.ok) {
    return NextResponse.json(toClientError(created.error), {
      status: httpStatusFor(created.error),
    });
  }
  return NextResponse.json(
    { mode: "relay", session: created.value },
    {
      status: 201,
      headers: { "Cache-Control": "no-store" },
    },
  );
}
