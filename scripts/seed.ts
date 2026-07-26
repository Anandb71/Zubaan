import "dotenv/config";

import { createClient } from "@supabase/supabase-js";

import {
  DEMO_AGENTS,
  DEMO_PRODUCT,
  SEED_CALL_AGENT,
  seedViolations,
} from "../dev/fixtures/zubaan-demo";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error("Seed skipped: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
  process.exitCode = 1;
} else {
  const db = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  await upsert("products", [
    {
      id: DEMO_PRODUCT.id,
      name: DEMO_PRODUCT.name,
      domain: DEMO_PRODUCT.domain,
      pdf_url: DEMO_PRODUCT.pdfUrl,
      terms_json: DEMO_PRODUCT.terms,
      required_disclosures: DEMO_PRODUCT.requiredDisclosures.map((item) => ({
        id: item.id,
        text: item.text,
        why_required: item.whyRequired,
        category: item.category,
        critical: item.critical,
      })),
      created_at: DEMO_PRODUCT.createdAt,
    },
  ]);

  await upsert(
    "agents",
    DEMO_AGENTS.map((agent) => ({ ...agent })),
  );

  const callRows = Array.from({ length: 50 }, (_, index) => {
    const id = `seed-call-${String(index + 1).padStart(2, "0")}`;
    const language = ["hi-IN", "bn-IN", "ta-IN", "te-IN", "mr-IN"][index % 5]!;
    const startedAt = new Date(Date.UTC(2026, 6, 20, 9 + index * 3));
    return {
      id,
      agent_id: SEED_CALL_AGENT[id] ?? DEMO_AGENTS[0]!.id,
      product_id: DEMO_PRODUCT.id,
      customer_name: `Demo customer ${index + 1}`,
      customer_lang: language,
      detected_lang: language,
      started_at: startedAt.toISOString(),
      ended_at: new Date(startedAt.getTime() + 14 * 60_000).toISOString(),
      status: "audited",
      transcript: [],
      satisfied_disclosure_ids: [],
    };
  });
  await upsert("calls", callRows);

  await upsert(
    "violations",
    seedViolations().map((violation) => ({
      id: violation.id,
      call_id: violation.callId,
      kind: violation.kind,
      ts_ms: violation.tsMs,
      utterance: violation.utterance,
      claim_made: violation.claimMade,
      contradicted_by: violation.contradictedBy,
      severity: violation.severity,
      suggested_correction: violation.suggestedCorrection,
      disclosure_id: violation.disclosureId,
      detected_lang: violation.detectedLang,
      source: violation.source,
      created_at: violation.createdAt,
    })),
  );

  console.log("Seeded 1 product, 6 agents, 50 calls, and 40 violations.");

  async function upsert(table: string, rows: Record<string, unknown>[]) {
    const { error } = await db.from(table).upsert(rows);
    if (error) throw new Error(`${table}: ${error.message}`);
  }
}
