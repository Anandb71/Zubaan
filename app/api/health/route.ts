import { NextResponse } from "next/server";

import { config, capabilities } from "@/lib/config";
import { poolHealth } from "@/lib/sarvam";
import { store } from "@/lib/store";

export async function GET() {
  return NextResponse.json({
    ok: true,
    storage: store.mode(),
    sarvam: config.sarvam.mode,
    capabilities: capabilities(),
    pools: poolHealth(),
  });
}
