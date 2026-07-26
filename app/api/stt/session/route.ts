import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json(
    {
      mode: "relay",
      endpoint: "/api/stt/relay",
      session: null,
      message: "Direct browser STT credentials are disabled.",
    },
    {
      headers: {
        "Cache-Control": "no-store",
        Deprecation: "true",
      },
    },
  );
}
