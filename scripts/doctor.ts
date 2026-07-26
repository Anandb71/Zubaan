import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local" });
loadEnv();

async function main() {
  const [{ config, capabilities }, { createClient }] = await Promise.all([
    import("../lib/config"),
    import("@supabase/supabase-js"),
  ]);

  const checks: Array<{
    name: string;
    status: "ok" | "degraded" | "failed";
    detail: string;
  }> = capabilities().map((capability) => ({
    name: capability.name,
    status: capability.status === "live" ? "ok" : "degraded",
    detail: capability.detail,
  }));

  if (config.sarvam.apiKey) {
    try {
      const response = await fetch(`${config.sarvam.baseUrl}/v1/models`, {
        headers: { "api-subscription-key": config.sarvam.apiKey },
        signal: AbortSignal.timeout(8_000),
      });
      checks.push({
        name: "sarvam_credentials",
        status: response.ok ? "ok" : "failed",
        detail: response.ok ? "Authenticated" : `HTTP ${response.status}`,
      });
    } catch (cause) {
      checks.push({
        name: "sarvam_credentials",
        status: "failed",
        detail: cause instanceof Error ? cause.message : String(cause),
      });
    }
  }

  if (config.storage.url && config.storage.serviceKey) {
    const client = createClient(config.storage.url, config.storage.serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error } = await client.from("organizations").select("id").limit(1);
    checks.push({
      name: "supabase_schema",
      status: error ? "failed" : "ok",
      detail: error ? error.message : "Multichannel schema available",
    });
  }

  for (const check of checks) {
    console.log(`${check.status.toUpperCase().padEnd(8)} ${check.name}: ${check.detail}`);
  }

  if (checks.some((check) => check.status === "failed")) process.exitCode = 1;
}

main().catch((cause) => {
  console.error(cause);
  process.exitCode = 1;
});
