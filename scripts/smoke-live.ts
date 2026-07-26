/**
 * One-shot live path smoke: chat 30b contradiction on a known lie.
 * Usage: npx tsx scripts/smoke-live.ts
 */
import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local" });
loadEnv();

async function main() {
  const { config } = await import("../lib/config");
  const { checkContradiction } = await import("../lib/engine/heuristics");
  const { chatJson } = await import("../lib/sarvam/chat");
  const { contradictionMessages } = await import("../lib/pipeline/prompts");
  const { getDomain } = await import("../lib/domains/registry");
  const { DEMO_PRODUCT } = await import("../dev/fixtures/zubaan-demo");
  const { contradictionSchema, zodValidator } = await import("../lib/pipeline/schemas");

  const utterance = "Sir, aapko guaranteed 12 percent return milega, bilkul pakka.";

  console.log("sarvam mode:", config.sarvam.mode);
  const heuristic = checkContradiction(utterance, DEMO_PRODUCT.terms);
  console.log("heuristic supported:", heuristic.supported, "severity:", heuristic.severity);

  if (config.sarvam.mode !== "live") {
    console.log("Skipping live chat — no key.");
    return;
  }

  const res = await chatJson(
    contradictionMessages(getDomain("insurance"), DEMO_PRODUCT.terms, utterance),
    { tier: "fast", temperature: 0, maxTokens: 300 },
    zodValidator(contradictionSchema),
  );

  if (!res.ok) {
    console.error("chat failed:", res.error.message);
    process.exitCode = 1;
    return;
  }

  console.log("30b:", JSON.stringify(res.value, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
