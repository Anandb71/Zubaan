import { NextResponse } from "next/server";
import { z } from "zod";

import { DEMO_AGENTS, DEMO_PRODUCT } from "@/dev/fixtures/zubaan-demo";
import { config } from "@/lib/config";
import { fromThrown, httpStatusFor, toClientError } from "@/lib/kernel";
import { store } from "@/lib/store";

const bodySchema = z.object({
  customerName: z.string().min(1).default("Sunita Devi"),
  customerLang: z.string().min(1).default("ta-IN"),
});

export async function POST(request: Request) {
  if (!config.features.demoMode) {
    return NextResponse.json(
      { error: { kind: "not_found", message: "Demo mode is disabled" } },
      { status: 404 },
    );
  }

  try {
    const body = bodySchema.parse(await request.json().catch(() => ({})));
    await store.saveProduct(DEMO_PRODUCT);
    for (const agent of DEMO_AGENTS) await store.saveAgent(agent);

    const call = await store.createCall({
      agentId: DEMO_AGENTS[0]!.id,
      productId: DEMO_PRODUCT.id,
      customerName: body.customerName,
      customerLang: body.customerLang,
    });

    return NextResponse.json({ call, demo: true }, { status: 201 });
  } catch (cause) {
    const error = fromThrown(cause);
    return NextResponse.json(toClientError(error), { status: httpStatusFor(error) });
  }
}
