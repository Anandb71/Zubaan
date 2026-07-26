import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const raw = readFileSync(".env.local", "utf8");
const env = {};
for (const line of raw.split(/\r?\n/)) {
  if (!line || line.trim().startsWith("#")) continue;
  const i = line.indexOf("=");
  if (i < 1) continue;
  const k = line.slice(0, i).trim();
  let v = line.slice(i + 1).trim();
  if (
    (v.startsWith('"') && v.endsWith('"')) ||
    (v.startsWith("'") && v.endsWith("'"))
  ) {
    v = v.slice(1, -1);
  }
  env[k] = v;
}

if (!env.ZUBAAN_ORGANIZATION_ID) {
  env.ZUBAAN_ORGANIZATION_ID = "00000000-0000-0000-0000-000000000001";
}

const keys = [
  "SARVAM_API_KEY",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "ZUBAAN_ORGANIZATION_ID",
  "LOG_LEVEL",
];

const targets = process.argv.includes("--preview-only")
  ? ["preview"]
  : ["production", "preview", "development"];
const sensitive = new Set(["SARVAM_API_KEY", "SUPABASE_SERVICE_ROLE_KEY"]);

for (const key of keys) {
  const value = env[key];
  if (!value) {
    console.log(`SKIP missing ${key}`);
    continue;
  }
  for (const target of targets) {
    const args = [
      "env",
      "add",
      key,
      target,
      "--value",
      value,
      "--yes",
      "--force",
    ];
    if (sensitive.has(key)) {
      if (target === "development") args.push("--no-sensitive");
      else args.push("--sensitive");
    }
    const r = spawnSync("vercel", args, { encoding: "utf8", shell: true });
    const out = `${r.stdout || ""}${r.stderr || ""}`;
    if (r.status === 0) {
      console.log(`${key} ${target} OK`);
    } else {
      const tail = out
        .split(/\r?\n/)
        .filter(Boolean)
        .slice(-3)
        .join(" | ");
      console.log(`${key} ${target} FAIL ${tail}`);
    }
  }
}
