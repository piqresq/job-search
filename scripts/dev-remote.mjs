/**
 * `npm run dev:remote` — `wrangler dev --remote`
 *
 * Uses Cloudflare's remote dev session: production Worker secrets and remote
 * bindings (D1, R2, queues, Durable Objects, etc.) can be hit from your machine.
 * Does not run local D1 migrations (those target local SQLite only).
 */
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

console.log(
  "\n[dev:remote] wrangler dev --remote — remote bindings / production-backed resources.\n" +
    "            Risk: real D1 data, DO state, queues, R2, RapidAPI/OpenAI quotas, review email.\n" +
    "            Prefer `npm run dev` for safe local-first work.\n"
);

const extra = process.argv.slice(2);
const child = spawn("npx", ["wrangler", "dev", "--remote", ...extra], {
  stdio: "inherit",
  cwd: root,
  env: process.env,
  shell: true,
});

child.on("exit", (code, signal) => {
  if (signal) process.exit(1);
  process.exit(code ?? 0);
});
