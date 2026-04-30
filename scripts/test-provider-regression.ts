/**
 * Safe regression checks for RapidAPI fetch (first key only, no rotation) and cycle cadence helpers.
 * No network, no secrets, no D1 remote — in-memory D1 stub for pipeline_state.
 *
 * Run: npx tsx scripts/test-provider-regression.ts
 */

import assert from "node:assert/strict";
import { utcYmdFromUnix } from "../src/db/pipelineState";
import { deriveProviderPauseKind } from "../src/orchestration/providerPauseKind";
import { rapidApiJsonRequest } from "../src/providers/lib/rapidApiJson";
import { includeEveryNCycles } from "../src/providers/lib/cycleCadence";
import { PlannedSearchBackoffError, PlannedSearchDoneForCycleError } from "../src/providers/lib/plannedSearch";
import { rapidApiFetch } from "../src/providers/rapidapiFetch";

function testCycleCadence() {
  const cycleA = "cycle-a";
  const cycleB = "cycle-b";
  assert.equal(includeEveryNCycles(cycleA, 5), includeEveryNCycles(cycleA, 5), "deterministic for a cycle");
  assert.equal(typeof includeEveryNCycles(cycleB, 5), "boolean");
  assert.equal(typeof includeEveryNCycles(cycleB, 2), "boolean");
}

/** Minimal D1 stub for `pipeline_state` plus read-only `app_settings` lookups. */
function createPipelineStateMock(initial: Record<string, string>): {
  db: D1Database;
  get: () => Record<string, string>;
} {
  const store = new Map<string, string>(Object.entries(initial));

  const db = {
    async batch() {
      return [];
    },
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          return {
            async first<T extends Record<string, unknown>>(): Promise<T | null> {
              if (sql.includes("SELECT v FROM pipeline_state")) {
                const k = String(args[0]);
                const v = store.get(k);
                return v != null ? ({ v } as unknown as T) : null;
              }
              if (sql.includes("SELECT value FROM app_settings")) {
                return null;
              }
              if (sql.includes("INSERT INTO pipeline_state") && sql.includes("RETURNING v")) {
                const k = String(args[0]);
                const current = parseInt(store.get(k) ?? "0", 10);
                const next = Number.isFinite(current) ? current + 1 : 1;
                store.set(k, String(next));
                return ({ v: String(next) } as unknown as T);
              }
              return null;
            },
            async run() {
              if (sql.includes("INSERT INTO pipeline_state") && !sql.includes("RETURNING")) {
                const k = String(args[0]);
                const current = parseInt(store.get(k) ?? "0", 10);
                if (sql.includes("DO UPDATE SET")) {
                  const next = Number.isFinite(current) ? current + 1 : 1;
                  store.set(k, String(next));
                } else {
                  const v = String(args[1]);
                  store.set(k, v);
                }
              }
            },
          };
        },
      };
    },
  } as unknown as D1Database;

  return {
    db,
    get: () => Object.fromEntries(store),
  };
}

function createNoopDb(): D1Database {
  return {
    async batch() {
      return [];
    },
    prepare() {
      return {
        bind() {
          return {
            async first() {
              return null;
            },
            async run() {
              return { success: true };
            },
          };
        },
      };
    },
  } as unknown as D1Database;
}

async function testRapidApiFetchUsesFirstKeyOnlyNoPhantom() {
  const { db } = createPipelineStateMock({});

  const env = {
    DB: db,
    RAPIDAPI_KEYS: "first-key,second-key-should-not-be-used",
  } as Env;

  const rapidUrl = "https://linkedin-job-search-api.p.rapidapi.com/active-jb-24h?limit=10&offset=0";

  const originalFetch = globalThis.fetch;
  let calls = 0;

  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    calls++;
    const h = new Headers(init?.headers as HeadersInit | undefined);
    assert.equal(h.get("X-RapidAPI-Key"), "first-key");
    return new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
  };

  try {
    const res = await rapidApiFetch(
      db,
      env,
      rapidUrl,
      "linkedin-job-search-api.p.rapidapi.com",
      "jobs_api",
    );
    assert.equal(res.ok, true);
    assert.equal(await res.text(), "[]");
    assert.equal(calls, 1, "single direct fetch to RapidAPI host, no Phantom");
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function testRapidApiFetchStopsAtProviderDailyCap() {
  const { db, get } = createPipelineStateMock({});
  const env = {
    DB: db,
    RAPIDAPI_KEYS: "direct-key",
    LINKEDIN_MAX_API_CALLS_PER_RUN: "1",
  } as Env;

  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
  };

  try {
    const url = "https://linkedin-job-search-api.p.rapidapi.com/active-jb-24h?limit=10&offset=0";
    const ymd = utcYmdFromUnix(Math.floor(Date.now() / 1000));
    const res = await rapidApiFetch(db, env, url, "linkedin-job-search-api.p.rapidapi.com", "linkedin_jobs", "cycle-1");
    assert.equal(res.ok, true);
    assert.equal(calls, 1);
    assert.equal(get()[`provider_utc_day_request_count:linkedin_jobs:${ymd}`], "1");

    await assert.rejects(
      rapidApiFetch(db, env, url, "linkedin-job-search-api.p.rapidapi.com", "linkedin_jobs", "cycle-1"),
      (error: unknown) => {
        assert.ok(error instanceof PlannedSearchDoneForCycleError);
        assert.equal((error as PlannedSearchDoneForCycleError).meta.requestCap, 1);
        assert.equal((error as PlannedSearchDoneForCycleError).meta.requestsUsed, 1);
        return true;
      },
    );
    assert.equal(calls, 1, "cap hit should stop before another outbound request");
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function testRapidApiJsonRequestTreatsPersistentQuotaAsDoneForCycle() {
  const db = createNoopDb();
  const env = {
    DB: db,
    RAPIDAPI_KEYS: "direct-key",
  } as Env;

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ message: "You have exceeded the monthly quota. Upgrade your plan." }), {
      status: 403,
      headers: { "content-type": "application/json" },
    });

  try {
    await assert.rejects(
      rapidApiJsonRequest(
        db,
        env,
        "https://example.com/jobs",
        "linkedin-job-search-api.p.rapidapi.com",
        "diagnostic_scope",
      ),
      (error: unknown) => {
        assert.ok(error instanceof PlannedSearchDoneForCycleError);
        assert.equal((error as PlannedSearchDoneForCycleError).meta.reason, "vendor_quota_exhausted");
        assert.equal(
          deriveProviderPauseKind((error as PlannedSearchDoneForCycleError).meta, true),
          "vendor_quota",
        );
        return true;
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function testRapidApiJsonRequestKeepsTransientLimitAsBackoff() {
  const db = createNoopDb();
  const env = {
    DB: db,
    RAPIDAPI_KEYS: "direct-key",
  } as Env;

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ message: "Too many requests right now" }), {
      status: 429,
      headers: {
        "content-type": "application/json",
        "retry-after": "120",
      },
    });

  try {
    await assert.rejects(
      rapidApiJsonRequest(
        db,
        env,
        "https://example.com/jobs",
        "linkedin-job-search-api.p.rapidapi.com",
        "diagnostic_scope",
      ),
      (error: unknown) => {
        assert.ok(error instanceof PlannedSearchBackoffError);
        assert.equal((error as PlannedSearchBackoffError).retryAfterSeconds, 120);
        return true;
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function main() {
  testCycleCadence();
  await testRapidApiFetchUsesFirstKeyOnlyNoPhantom();
  await testRapidApiFetchStopsAtProviderDailyCap();
  await testRapidApiJsonRequestTreatsPersistentQuotaAsDoneForCycle();
  await testRapidApiJsonRequestKeepsTransientLimitAsBackoff();
  console.log("test-provider-regression: all checks passed");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
