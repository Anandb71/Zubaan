import { spawn } from "node:child_process";

import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local" });
loadEnv();

const dryRun = process.argv.includes("--dry-run");
const databaseUrl = resolveDatabaseUrl();
if (!databaseUrl) {
  console.error(
    "Migration push requires SUPABASE_DB_URL, or NEXT_PUBLIC_SUPABASE_URL plus SUPABASE_DB_PASSWORD.",
  );
  process.exit(1);
}

const executable = process.platform === "win32" ? "npx.cmd" : "npx";
const args = [
  "supabase",
  "db",
  "push",
  "--db-url",
  databaseUrl,
  "--include-all",
  "--yes",
  "--dns-resolver",
  "https",
  ...(dryRun ? ["--dry-run"] : []),
];
const child = spawn(executable, args, {
  cwd: process.cwd(),
  env: process.env,
  shell: false,
  stdio: ["ignore", "pipe", "pipe"],
});

child.stdout.on("data", (chunk: Buffer) => {
  process.stdout.write(redact(chunk.toString()));
});
child.stderr.on("data", (chunk: Buffer) => {
  process.stderr.write(redact(chunk.toString()));
});
child.on("error", (cause) => {
  console.error(`Could not launch Supabase CLI: ${cause.message}`);
  process.exitCode = 1;
});
child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});

function resolveDatabaseUrl(): string | undefined {
  const explicit = process.env.SUPABASE_DB_URL?.trim();
  if (explicit) return explicit;

  const apiUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const password = process.env.SUPABASE_DB_PASSWORD?.trim();
  if (!apiUrl || !password) return undefined;
  const projectRef = new URL(apiUrl).hostname.split(".")[0];
  if (!projectRef) return undefined;
  return `postgresql://postgres:${encodeURIComponent(password)}@db.${projectRef}.supabase.co:5432/postgres`;
}

function redact(value: string): string {
  let output = value.replaceAll(databaseUrl!, "[redacted-database-url]");
  const password = process.env.SUPABASE_DB_PASSWORD;
  if (password) output = output.replaceAll(password, "[redacted]");
  return output;
}
