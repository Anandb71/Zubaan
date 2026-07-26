import { NextResponse } from "next/server";

import { httpStatusFor, toClientError, fromThrown } from "@/lib/kernel";
import { buildSttSession } from "@/lib/sarvam";

export async function GET() {
  try {
    const session = buildSttSession({
      languageCode: "unknown",
      mode: "codemix",
      highVadSensitivity: true,
      vadSignals: true,
    });
    if (!session.ok) {
      return NextResponse.json(
        { mode: "mock", session: null, reason: session.error.message },
        { status: 200 },
      );
    }
    return NextResponse.json({ mode: "live", session: session.value });
  } catch (cause) {
    const error = fromThrown(cause);
    return NextResponse.json(toClientError(error), { status: httpStatusFor(error) });
  }
}
