import { NextResponse } from "next/server";

import { httpStatusFor, toClientError, fromThrown } from "@/lib/kernel";
import { endCall } from "@/lib/pipeline/end-call";

export async function POST(
  _req: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const result = await endCall(id);
    return NextResponse.json(result);
  } catch (cause) {
    const error = fromThrown(cause);
    return NextResponse.json(toClientError(error), { status: httpStatusFor(error) });
  }
}
