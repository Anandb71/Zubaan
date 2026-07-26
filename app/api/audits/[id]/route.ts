import { NextResponse } from "next/server";

import { httpStatusFor, toClientError, fromThrown } from "@/lib/kernel";
import { store } from "@/lib/store";

export async function GET(
  _req: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const audit = await store.getAudit(id);
    if (!audit) {
      return NextResponse.json(
        { error: { kind: "not_found", message: "audit not found" } },
        { status: 404 },
      );
    }
    const call = await store.getCall(audit.callId);
    const violations = await store.listViolations(audit.callId);
    return NextResponse.json({ audit, call, violations });
  } catch (cause) {
    const error = fromThrown(cause);
    return NextResponse.json(toClientError(error), { status: httpStatusFor(error) });
  }
}
