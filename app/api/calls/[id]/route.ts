import { NextResponse } from "next/server";

import { httpStatusFor, toClientError, fromThrown } from "@/lib/kernel";
import { store } from "@/lib/store";

export async function GET(
  _req: Request,
  { params }: { params: { id: string } },
) {
  try {
    const call = await store.getCall(params.id);
    if (!call) {
      return NextResponse.json(
        { error: { kind: "not_found", message: "call not found" } },
        { status: 404 },
      );
    }
    const violations = await store.listViolations(params.id);
    return NextResponse.json({ call, violations });
  } catch (cause) {
    const error = fromThrown(cause);
    return NextResponse.json(toClientError(error), { status: httpStatusFor(error) });
  }
}
