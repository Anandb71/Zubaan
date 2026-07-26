import { NextResponse } from "next/server";
import { z } from "zod";

import { httpStatusFor, toClientError, fromThrown } from "@/lib/kernel";
import { store } from "@/lib/store";

export async function GET() {
  try {
    const products = await store.listProducts();
    return NextResponse.json({ products });
  } catch (cause) {
    const error = fromThrown(cause);
    return NextResponse.json(toClientError(error), { status: httpStatusFor(error) });
  }
}

const patchSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  terms: z.record(z.unknown()).optional(),
  requiredDisclosures: z
    .array(
      z.object({
        id: z.string(),
        text: z.string(),
        whyRequired: z.string().default(""),
        category: z.string().optional(),
        critical: z.boolean().default(true),
      }),
    )
    .optional(),
});

export async function PATCH(req: Request) {
  try {
    const body = patchSchema.parse(await req.json());
    const existing = await store.getProduct(body.id);
    if (!existing) {
      return NextResponse.json(
        { error: { kind: "not_found", message: "Product not found" } },
        { status: 404 },
      );
    }
    const saved = await store.saveProduct({
      ...existing,
      name: body.name ?? existing.name,
      terms: (body.terms as typeof existing.terms) ?? existing.terms,
      requiredDisclosures: body.requiredDisclosures ?? existing.requiredDisclosures,
    });
    return NextResponse.json({ product: saved });
  } catch (cause) {
    const error = fromThrown(cause);
    return NextResponse.json(toClientError(error), { status: httpStatusFor(error) });
  }
}
