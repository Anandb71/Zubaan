import { NextResponse } from "next/server";

import { config, capabilities } from "@/lib/config";
import { poolHealth } from "@/lib/sarvam";
import { sttRelay } from "@/lib/sarvam/stt-relay";
import { store } from "@/lib/store";

export async function GET() {
  return NextResponse.json({
    ok: true,
    storage: store.mode(),
    sarvam: config.sarvam.mode,
    capabilities: capabilities(),
    pools: poolHealth(),
    relay: sttRelay.health(),
  });
}
