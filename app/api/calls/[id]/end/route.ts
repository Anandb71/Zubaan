import { NextResponse } from "next/server";

import { httpStatusFor, toClientError, fromThrown } from "@/lib/kernel";
import { endCall } from "@/lib/pipeline/end-call";

export async function POST(
  _req: Request,
  { params }: { params: { id: string } },
) {
  try {
    const result = await endCall(params.id);
    return NextResponse.json(result);
  } catch (cause) {
    const error = fromThrown(cause);
    return NextResponse.json(toClientError(error), { status: httpStatusFor(error) });
  }
}
