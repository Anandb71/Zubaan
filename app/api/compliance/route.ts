import { NextResponse } from "next/server";

import { getComplianceSnapshot } from "@/lib/analytics";
import { httpStatusFor, toClientError, fromThrown } from "@/lib/kernel";

export async function GET() {
  try {
    const snapshot = await getComplianceSnapshot();
    return NextResponse.json(snapshot);
  } catch (cause) {
    const error = fromThrown(cause);
    return NextResponse.json(toClientError(error), { status: httpStatusFor(error) });
  }
}
