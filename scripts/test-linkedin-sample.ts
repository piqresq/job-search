/**
 * One-off: call Fantastic Jobs LinkedIn API (default `active-jb-24h`) with a title filter.
 *
 * Usage (repo root):
 *   npx tsx scripts/test-linkedin-sample.ts
 *   npx tsx scripts/test-linkedin-sample.ts --limit=25 --offset=0
 *   npx tsx scripts/test-linkedin-sample.ts --title="Customer Success Manager"
 *   npx tsx scripts/test-linkedin-sample.ts --location="United Kingdom"
 *   npx tsx scripts/test-linkedin-sample.ts --path=/active-jb-7d
 *
 * Loads RAPIDAPI_KEY from .dev.vars and/or process.env (same as run-hard-filter-test).
 * Non-6m endpoints allow 10–100 jobs per call.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildLinkedinJobsUrl, LINKEDIN_JOBS_DEFAULT_PATH } from "../src/providers/linkedinJobs";

const HOST = "linkedin-job-search-api.p.rapidapi.com";

function parseDevVars(filePath: string): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    const s = readFileSync(filePath, "utf8");
    for (const line of s.split(/\n/)) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const eq = t.indexOf("=");
      if (eq <= 0) continue;
      const k = t.slice(0, eq).trim();
      let v = t.slice(eq + 1).trim();
      if (
        (v.startsWith('"') && v.endsWith('"')) ||
        (v.startsWith("'") && v.endsWith("'"))
      ) {
        v = v.slice(1, -1);
      }
      out[k] = v;
    }
  } catch {
    /* no .dev.vars */
  }
  return out;
}

function mergeEnvFromDevVars(): void {
  const p = join(process.cwd(), ".dev.vars");
  const vars = parseDevVars(p);
  for (const [k, v] of Object.entries(vars)) {
    if (process.env[k] === undefined || process.env[k] === "") process.env[k] = v;
  }
}

function clampLimit7d(n: number): number {
  if (n < 10) return 10;
  if (n > 100) return 100;
  return n;
}

function parseArgs(): {
  title: string;
  limit: number;
  offset: number;
  location?: string;
  apiPath: string;
} {
  let title = "Customer Success Manager";
  let limit = 10;
  let offset = 0;
  let location: string | undefined;
  let apiPath = LINKEDIN_JOBS_DEFAULT_PATH;
  for (const a of process.argv.slice(2)) {
    if (a.startsWith("--title=")) {
      const t = a.slice("--title=".length).trim();
      if (t) title = t;
    } else if (a.startsWith("--limit=")) {
      const n = parseInt(a.slice("--limit=".length), 10);
      if (!Number.isNaN(n)) limit = clampLimit7d(n);
    } else if (a.startsWith("--offset=")) {
      const n = parseInt(a.slice("--offset=".length), 10);
      if (!Number.isNaN(n) && n >= 0) offset = n;
    } else if (a.startsWith("--location=")) {
      const t = a.slice("--location=".length).trim();
      if (t) location = t;
    } else if (a.startsWith("--path=")) {
      const t = a.slice("--path=".length).trim();
      if (t) apiPath = t.startsWith("/") ? t : `/${t}`;
    }
  }
  return { title, limit, offset, location, apiPath };
}

function pickString(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

mergeEnvFromDevVars();

const key = process.env.RAPIDAPI_KEY?.trim();
if (!key) {
  console.error("Missing RAPIDAPI_KEY (set in .dev.vars or environment).");
  process.exit(1);
}

const { title, limit, offset, location, apiPath } = parseArgs();

const url = buildLinkedinJobsUrl({
  apiPath,
  limit,
  offset,
  titleFilter: title,
  locationFilter: location,
  descriptionType: "text",
});

console.log("GET", url.toString().replace(key, "***"));

const res = await fetch(url.toString(), {
  headers: {
    "X-RapidAPI-Key": key,
    "X-RapidAPI-Host": HOST,
  },
});

const text = await res.text();
let body: unknown;
try {
  body = JSON.parse(text) as unknown;
} catch {
  console.error("Non-JSON response:", text.slice(0, 800));
  process.exit(1);
}

if (!res.ok) {
  console.error("HTTP", res.status, body);
  process.exit(1);
}

if (!Array.isArray(body)) {
  console.error("Expected JSON array, got:", typeof body, body);
  process.exit(1);
}

const rows = body as Record<string, unknown>[];
const stamp = new Date().toISOString().replace(/[:.]/g, "-");

const outDir = join(process.cwd(), "output");
mkdirSync(outDir, { recursive: true });
const outPath = join(outDir, `linkedin-sample-${stamp}.json`);
writeFileSync(outPath, JSON.stringify(body, null, 2), "utf8");

console.log("\nSaved full response:", outPath);
console.log("Count:", rows.length);

const summary = rows.map((r, i) => ({
  i,
  id: pickString(r.id),
  date_posted: pickString(r.date_posted),
  title: pickString(r.title),
  organization: pickString(r.organization),
  locations_derived: r.locations_derived,
  countries_derived: r.countries_derived,
  remote_derived: r.remote_derived,
  employment_type: r.employment_type,
  url: pickString(r.url),
  description_len: pickString(r.description_text)?.length ?? 0,
}));

console.log("\nSummary (first fields):");
console.log(JSON.stringify(summary, null, 2));

if (rows[0]) {
  const k = Object.keys(rows[0]).sort();
  console.log("\nTop-level keys on first job (" + k.length + "):", k.join(", "));
}
