import { NextResponse } from "next/server";

import { httpStatusFor, toClientError, fromThrown } from "@/lib/kernel";
import { store } from "@/lib/store";

export async function GET(
  _req: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const call = await store.getCall(id);
    if (!call) {
      return NextResponse.json(
        { error: { kind: "not_found", message: "call not found" } },
        { status: 404 },
      );
    }
    const violations = await store.listViolations(id);
    return NextResponse.json({ call, violations });
  } catch (cause) {
    const error = fromThrown(cause);
    return NextResponse.json(toClientError(error), { status: httpStatusFor(error) });
  }
}
