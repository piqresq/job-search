/**
 * Local dev entry: ensure .dev.vars exists, apply D1 migrations to local SQLite,
 * warn on empty required secrets, then exec wrangler dev (args forwarded).
 *
 * Note: Cloudflare does not expose Worker secret *values* after upload
 * (no `wrangler secret get`). One-way sync is `wrangler secret put` / `secret bulk`
 * from a file you already have — not from the API back to disk.
 */
import { spawn } from "node:child_process";
import {
  applyLocalD1Migrations,
  ensureDevVarsFile,
  repoRoot,
  warnIfSecretsMissing,
} from "./dev-vars-support.mjs";

ensureDevVarsFile();
warnIfSecretsMissing();

try {
  applyLocalD1Migrations();
} catch {
  process.exit(1);
}

const extra = process.argv.slice(2);
const child = spawn("npx", ["wrangler", "dev", ...extra], {
  stdio: "inherit",
  cwd: repoRoot,
  env: process.env,
  shell: true,
});

child.on("exit", (code, signal) => {
  if (signal) process.exit(1);
  process.exit(code ?? 0);
});
