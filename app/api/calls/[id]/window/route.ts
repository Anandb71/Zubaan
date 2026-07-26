import { NextResponse } from "next/server";
import { z } from "zod";

import { httpStatusFor, toClientError, fromThrown } from "@/lib/kernel";
import { processWindow } from "@/lib/pipeline/live";
import { store } from "@/lib/store";

const bodySchema = z.object({
  utterances: z
    .array(
      z.object({
        tsMs: z.number(),
        text: z.string(),
        language: z.string().optional(),
        final: z.boolean().optional(),
      }),
    )
    .min(1),
  detectedLang: z.string().optional(),
});

export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const json = await req.json();
    const body = bodySchema.parse(json);
    const result = await processWindow({
      callId: id,
      utterances: body.utterances,
      detectedLang: body.detectedLang,
    });
    const call = await store.getCall(id);
    return NextResponse.json({ ...result, call });
  } catch (cause) {
    const error = fromThrown(cause);
    return NextResponse.json(toClientError(error), { status: httpStatusFor(error) });
  }
}
