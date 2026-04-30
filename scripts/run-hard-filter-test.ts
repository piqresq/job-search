/**
 * Local test: fetch one JSearch page, run applyHardFilters on each listing, write passed/rejected + logs to output/.
 *
 * Usage (from repo root):
 *   npx tsx scripts/run-hard-filter-test.ts
 *   npx tsx scripts/run-hard-filter-test.ts --country=de --query=support+manager
 *     (We never send JSearch `language=` — API default per country, same as curl.)
 *   npx tsx scripts/run-hard-filter-test.ts --country=uk --query=support+manager
 *   npm run test:hard-filters:uk  — UK + support manager + --allow-onsite-search
 *   npx tsx scripts/run-hard-filter-test.ts --country=de --query=support+manager --allow-onsite-search
 *     (Sets work_from_home=false on the API call only; hard filters still require remote listings.)
 *
 * Default `country` is `eu`: one request per EU member ISO code (see JSEARCH_EU_COUNTRY_CODES), merged and
 * deduped by `job_id`. JSearch's query param `country=eu` returns HTTP 200 but empty `data` — we do not use it.
 *
 * Loads API key from .dev.vars and/or process.env (RAPIDAPI_KEY).
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { applyHardFilters, fetchUsdGbpToEurRates } from "../src/pipeline/hardFilters";
import {
  buildJsearchUrl,
  JSEARCH_EU_COUNTRY_CODES,
  normalizeJsearchApiJob,
} from "../src/providers/jsearch";
import type { NormalizedJob } from "../src/types/job";

const JSEARCH_HOST = "jsearch.p.rapidapi.com";

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

function isEuAggregate(country: string): boolean {
  return country.trim().toLowerCase() === "eu";
}

function parseArgs(): {
  country: string;
  page: number;
  queryOverride?: string;
  /** When false, JSearch request uses work_from_home=false (more listings); hard filters still enforce remote. */
  jsearchRemoteOnly: boolean;
} {
  const fromEnv = process.env.JSEARCH_TEST_COUNTRY?.trim();
  let country = fromEnv && fromEnv.length > 0 ? fromEnv : "eu";
  let page = 1;
  let queryOverride: string | undefined;
  let allowOnsiteSearch = false;
  for (const a of process.argv.slice(2)) {
    if (a.startsWith("--country=")) {
      const c = a.slice("--country=".length).trim();
      if (c) country = c;
    } else if (a.startsWith("--page=")) {
      const n = parseInt(a.slice("--page=".length), 10);
      if (!Number.isNaN(n) && n >= 1) page = n;
    } else if (a.startsWith("--query=")) {
      const q = a.slice("--query=".length).trim().replace(/\+/g, " ");
      if (q) queryOverride = q;
    } else if (a === "--allow-onsite-search") {
      allowOnsiteSearch = true;
    }
  }
  const jsearchRemoteOnly = !allowOnsiteSearch;
  country = country.trim().toLowerCase();
  return { country, page, queryOverride, jsearchRemoteOnly };
}

function employmentTypes(): "FULLTIME" | "PARTTIME" {
  const v = process.env.JSEARCH_EMPLOYMENT_TYPES?.trim().toUpperCase();
  return v === "PARTTIME" ? "PARTTIME" : "FULLTIME";
}

type FetchCountryResult = {
  country: string;
  url: string;
  httpStatus: number;
  ok: boolean;
  data: Record<string, unknown>[];
  parseError?: string;
};

async function fetchJsearchOneCountry(
  key: string,
  params: {
    query: string;
    page: number;
    employmentTypes: string;
    datePosted: string;
    country: string;
    workFromHome: boolean;
  },
): Promise<FetchCountryResult> {
  const url = buildJsearchUrl({
    query: params.query,
    page: params.page,
    numPages: 1,
    country: params.country,
    employmentTypes: params.employmentTypes,
    datePosted: params.datePosted,
    workFromHome: params.workFromHome,
  });
  const res = await fetch(url.toString(), {
    headers: {
      "X-RapidAPI-Key": key,
      "X-RapidAPI-Host": JSEARCH_HOST,
    },
  });
  const rawText = await res.text();
  let data: Record<string, unknown>[] = [];
  let parseError: string | undefined;
  try {
    const body = JSON.parse(rawText) as { data?: Record<string, unknown>[] };
    data = body.data ?? [];
  } catch {
    parseError = rawText.slice(0, 200);
  }
  return {
    country: params.country,
    url: url.toString(),
    httpStatus: res.status,
    ok: res.ok,
    data,
    parseError,
  };
}

function mergeEuResults(results: FetchCountryResult[]): Record<string, unknown>[] {
  const seen = new Set<string>();
  const merged: Record<string, unknown>[] = [];
  for (const r of results) {
    for (const item of r.data) {
      const jid = typeof item.job_id === "string" ? item.job_id : "";
      if (jid) {
        if (seen.has(jid)) continue;
        seen.add(jid);
      }
      merged.push(item);
    }
  }
  return merged;
}

type RejectedRow = {
  job: NormalizedJob;
  reasons: string[];
};

async function main(): Promise<void> {
  mergeEnvFromDevVars();

  const key = process.env.RAPIDAPI_KEY?.trim();
  if (!key) {
    console.error("Missing RAPIDAPI_KEY (set in .dev.vars or environment).");
    process.exit(1);
  }

  const { country, page, queryOverride, jsearchRemoteOnly } = parseArgs();
  const query =
    queryOverride?.trim() ||
    process.env.JSEARCH_QUERY?.trim() ||
    "Technical Customer Success remote";
  const datePosted = process.env.JSEARCH_DATE_POSTED?.trim() || "month";
  const emp = employmentTypes();

  let rawList: Record<string, unknown>[];
  let rawFileBody: string;
  let requestSummary: string;
  let httpLine: string;
  let summaryExtra: Record<string, unknown> = {};

  if (isEuAggregate(country)) {
    const codes = [...JSEARCH_EU_COUNTRY_CODES];
    console.log(
      `EU mode: ${codes.length} requests (merged, deduped by job_id); JSearch ?country=eu returns no rows.`,
    );
    const results = await Promise.all(
      codes.map((c) =>
        fetchJsearchOneCountry(key, {
          query,
          page,
          employmentTypes: emp,
          datePosted,
          country: c,
          workFromHome: jsearchRemoteOnly,
        }),
      ),
    );
    rawList = mergeEuResults(results);
    const perCountry = results.map((r) => ({
      country: r.country,
      httpStatus: r.httpStatus,
      ok: r.ok,
      count: r.data.length,
      parseError: r.parseError,
    }));
    const okCount = results.filter((r) => r.ok).length;
    rawFileBody = JSON.stringify(
      {
        mode: "eu_fanout",
        note: "Unique job_id across EU ISO list; API parameter country=eu is not used (empty data).",
        query,
        page,
        employment_types: emp,
        date_posted: datePosted,
        work_from_home: jsearchRemoteOnly,
        perCountry,
        data: rawList,
      },
      null,
      2,
    );
    requestSummary = `EU fan-out: ${codes.length} GETs (see perCountry in raw-jsearch-response.json)`;
    httpLine = `${okCount}/${results.length} HTTP OK`;
    summaryExtra = {
      mode: "eu_fanout",
      countriesRequested: codes.length,
      httpOkFraction: `${okCount}/${results.length}`,
      perCountry,
    };
  } else {
    const url = buildJsearchUrl({
      query,
      page,
      numPages: 1,
      country,
      employmentTypes: emp,
      datePosted,
      workFromHome: jsearchRemoteOnly,
    });
    console.log("GET", url.toString());
    const res = await fetch(url.toString(), {
      headers: {
        "X-RapidAPI-Key": key,
        "X-RapidAPI-Host": JSEARCH_HOST,
      },
    });
    const rawText = await res.text();
    if (!res.ok) {
      console.error("HTTP", res.status, rawText.slice(0, 800));
      process.exit(1);
    }
    let body: { data?: Record<string, unknown>[] };
    try {
      body = JSON.parse(rawText) as { data?: Record<string, unknown>[] };
    } catch {
      console.error("Non-JSON response:", rawText.slice(0, 500));
      process.exit(1);
    }
    rawList = body.data ?? [];
    rawFileBody = rawText;
    requestSummary = url.toString();
    httpLine = String(res.status);
    summaryExtra = {
      mode: "single_country",
      country,
      jsearchWorkFromHome: jsearchRemoteOnly,
    };
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outDir = join(process.cwd(), "output", `hard-filter-test-${stamp}`);
  mkdirSync(outDir, { recursive: true });

  writeFileSync(join(outDir, "raw-jsearch-response.json"), rawFileBody, "utf8");

  const passed: NormalizedJob[] = [];
  const rejected: RejectedRow[] = [];
  const skipped: { reason: string; raw?: Record<string, unknown> }[] = [];

  const fx = await fetchUsdGbpToEurRates();
  if (!fx) {
    console.warn("Frankfurter FX unavailable; USD/GBP salary floors skipped in this test run");
  }

  for (const item of rawList) {
    const job = normalizeJsearchApiJob(item);
    if (!job) {
      skipped.push({ reason: "normalize_failed_or_missing_fields", raw: item });
      continue;
    }
    const fr = applyHardFilters(job, fx);
    if (fr.pass) {
      passed.push(job);
    } else {
      rejected.push({ job, reasons: fr.reasons });
    }
  }

  writeFileSync(
    join(outDir, "passed.json"),
    JSON.stringify(passed, null, 2),
    "utf8",
  );
  writeFileSync(
    join(outDir, "rejected.json"),
    JSON.stringify(rejected, null, 2),
    "utf8",
  );
  writeFileSync(
    join(outDir, "skipped-normalize.json"),
    JSON.stringify(skipped, null, 2),
    "utf8",
  );

  const DESC_LOG_MAX = 2500;

  const logLines: string[] = [
    `Hard filter test (JSearch → normalize → applyHardFilters only)`,
    `Time: ${new Date().toISOString()}`,
    `JSearch query: ${query}`,
    `JSearch language parameter: not sent (API default per country)`,
    `JSearch work_from_home: ${jsearchRemoteOnly}`,
    `Request: ${requestSummary}`,
    `HTTP: ${httpLine}`,
    `Raw listings (after EU merge/dedupe if applicable): ${rawList.length}`,
    `Normalized + filtered: ${passed.length + rejected.length}`,
    `Passed: ${passed.length}`,
    `Rejected (hard filter): ${rejected.length}`,
    `Skipped (normalize): ${skipped.length}`,
    "",
    "=== DROPPED BY HARD FILTERS (full listing + reasons) ===",
    "",
  ];

  rejected.forEach((r, i) => {
    const j = r.job;
    const desc =
      j.description.length > DESC_LOG_MAX
        ? `${j.description.slice(0, DESC_LOG_MAX)}\n… [truncated, total ${j.description.length} chars]`
        : j.description;
    logLines.push(`--- Dropped #${i + 1} ---`);
    logLines.push(`externalId: ${j.externalId}`);
    logLines.push(`title: ${j.title}`);
    logLines.push(`company: ${j.company}`);
    logLines.push(`location: ${j.location}`);
    logLines.push(`country: ${j.country ?? "(none)"}`);
    logLines.push(`isRemote (listing): ${j.isRemote}`);
    logLines.push(`jobUrl: ${j.jobUrl}`);
    logLines.push(`applyUrl: ${j.applyUrl}`);
    logLines.push("reasons:");
    for (const reason of r.reasons) {
      logLines.push(`  - ${reason}`);
    }
    logLines.push("description:");
    logLines.push(desc);
    logLines.push("");
  });

  logLines.push("=== PASSED ===", "");
  passed.forEach((j, i) => {
    logLines.push(`${i + 1}. ${j.title} @ ${j.company} (${j.externalId})`);
  });
  logLines.push("");

  if (skipped.length) {
    logLines.push("=== SKIPPED — NOT NORMALIZED (raw excerpt + reason) ===", "");
    skipped.forEach((s, i) => {
      logLines.push(`--- Skip #${i + 1} ---`);
      logLines.push(`reason: ${s.reason}`);
      const raw = s.raw;
      if (raw && typeof raw === "object") {
        const id = raw.job_id;
        const title = raw.job_title;
        logLines.push(`raw job_id: ${typeof id === "string" ? id : JSON.stringify(id)}`);
        logLines.push(`raw job_title: ${typeof title === "string" ? title : JSON.stringify(title)}`);
        logLines.push(`raw JSON (compact): ${JSON.stringify(raw).slice(0, 1200)}${JSON.stringify(raw).length > 1200 ? "…" : ""}`);
      }
      logLines.push("");
    });
  }

  writeFileSync(join(outDir, "hard-filter-log.txt"), logLines.join("\n"), "utf8");

  const summary = {
    fetchedAt: new Date().toISOString(),
    jsearchQuery: query,
    requestUrl: requestSummary,
    httpStatus: httpLine,
    ...summaryExtra,
    counts: {
      raw: rawList.length,
      passed: passed.length,
      rejected: rejected.length,
      skippedNormalize: skipped.length,
    },
    artifacts: {
      hardFilterLog: "hard-filter-log.txt",
      rawJsearch: "raw-jsearch-response.json",
      passedJobs: "passed.json",
      rejectedJobs: "rejected.json",
      skippedNormalize: "skipped-normalize.json",
    },
  };
  writeFileSync(join(outDir, "summary.json"), JSON.stringify(summary, null, 2), "utf8");

  console.log(`Wrote ${outDir}`);
  console.log(summary.counts);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
