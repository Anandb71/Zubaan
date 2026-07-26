import { NextResponse } from "next/server";
import { z } from "zod";

import { httpStatusFor, toClientError, fromThrown } from "@/lib/kernel";
import { store } from "@/lib/store";

const bodySchema = z.object({
  agentId: z.string().min(1),
  productId: z.string().min(1),
  customerName: z.string().min(1),
  customerLang: z.string().min(1),
});

export async function POST(req: Request) {
  try {
    const json = await req.json().catch(() => ({}));
    const body = bodySchema.parse(json);

    const call = await store.createCall({
      agentId: body.agentId,
      productId: body.productId,
      customerName: body.customerName,
      customerLang: body.customerLang,
    });

    return NextResponse.json({ call }, { status: 201 });
  } catch (cause) {
    const error = fromThrown(cause);
    return NextResponse.json(toClientError(error), { status: httpStatusFor(error) });
  }
}
