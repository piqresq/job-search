import { execSync } from "node:child_process";
import { copyFileSync, existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const devVarsPath = () => join(repoRoot, ".dev.vars");
const examplePath = () => join(repoRoot, ".dev.vars.example");

export function parseDevVars(text) {
  /** @type {Map<string, string>} */
  const m = new Map();
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    const k = t.slice(0, eq).trim();
    const v = t.slice(eq + 1).trim();
    m.set(k, v);
  }
  return m;
}

export function ensureDevVarsFile() {
  const dv = devVarsPath();
  if (existsSync(dv)) return;
  const ex = examplePath();
  if (!existsSync(ex)) {
    console.error("[dev-vars] Missing .dev.vars.example — cannot bootstrap .dev.vars");
    process.exit(1);
  }
  copyFileSync(ex, dv);
  console.log(
    "[dev-vars] Created .dev.vars from .dev.vars.example.\n" +
      "           Paste secrets from your password manager (Cloudflare cannot export them).\n" +
      "           Required for full stack: OPENAI_API_KEY, REVIEW_TOKEN_SECRET, DASHBOARD_PASSWORD,\n" +
      "           RAPIDAPI_KEY (or RAPIDAPI_KEYS)."
  );
}

export function warnIfSecretsMissing() {
  const dv = devVarsPath();
  if (!existsSync(dv)) return;
  let text;
  try {
    text = readFileSync(dv, "utf8");
  } catch {
    return;
  }
  const m = parseDevVars(text);
  const missing = [];
  if (!(m.get("OPENAI_API_KEY") || "").trim()) missing.push("OPENAI_API_KEY");
  if (!(m.get("REVIEW_TOKEN_SECRET") || "").trim()) missing.push("REVIEW_TOKEN_SECRET");
  if (!(m.get("DASHBOARD_PASSWORD") || "").trim()) missing.push("DASHBOARD_PASSWORD");
  const rapid = (m.get("RAPIDAPI_KEY") || m.get("RAPIDAPI_KEYS") || "").trim();
  if (!rapid) missing.push("RAPIDAPI_KEY or RAPIDAPI_KEYS");
  const pub = (m.get("PUBLIC_BASE_URL") || "").trim();
  if (pub && !pub.includes("127.0.0.1") && !pub.includes("localhost")) {
    console.warn(
      `[dev-vars] PUBLIC_BASE_URL is "${pub}" — for local links use http://127.0.0.1:8787 (or your dev port).`
    );
  }
  if (missing.length) {
    console.warn(
      `[dev-vars] Empty required values in .dev.vars: ${missing.join(", ")} — some routes will fail until set.`
    );
  }
}

export function applyLocalD1Migrations() {
  execSync("npx wrangler d1 migrations apply job-search-db --local", {
    stdio: "inherit",
    cwd: repoRoot,
    env: process.env,
    shell: true,
  });
}
