import { getResolvedProviderDailyRequestCap } from "../db/appSettings";
import { applyStatisticsDeltas, type StatisticsVariantDimension } from "../db/statistics";
import {
  bumpProviderUtcDayRequestCount,
  getProviderUtcDayRequestCount,
  utcYmdFromUnix,
} from "../db/pipelineState";
import { log, observabilityLog } from "../logging/appLog";
import type { JobSourceId } from "../types/job";
import { nextUtcMidnightUnix } from "../lib/nextUtcMidnight";
import { PlannedSearchDoneForCycleError } from "./lib/plannedSearch";
import { parseRapidApiKeys } from "./rapidapiKeys";

const RAPIDAPI_REQUEST_TIMEOUT_MS = 60_000;

function providerIdFromScope(scope: string): JobSourceId | null {
  if (scope === "linkedin_jobs" || scope === "jsearch" || scope === "jobs_api") return scope;
  return null;
}

async function ensureProviderDailyRequestCapNotReached(
  db: D1Database,
  env: Env,
  scope: string,
): Promise<void> {
  const providerId = providerIdFromScope(scope);
  if (!providerId) return;
  const cap = await getResolvedProviderDailyRequestCap(db, env, providerId);
  if (cap <= 0) return;

  const now = Math.floor(Date.now() / 1000);
  const ymdUtc = utcYmdFromUnix(now);
  const current = await getProviderUtcDayRequestCount(db, providerId, ymdUtc);
  if (current >= cap) {
    const nextEligibleAt = nextUtcMidnightUnix(now);
    // Expected throttling — not a structured operational incident (avoids ops / header noise).
    await log.info(env, providerId, "Provider daily request cap reached; skipping vendor requests until next UTC day", {
      utcDay: ymdUtc,
      requestCap: cap,
      requestsUsed: current,
      nextEligibleAt,
      nextEligibleAtIso: new Date(nextEligibleAt * 1000).toISOString(),
    });
    throw new PlannedSearchDoneForCycleError(`${providerId} daily request cap reached`, nextEligibleAt, {
      requestCap: cap,
      requestsUsed: current,
      utcDay: ymdUtc,
    });
  }
}

/**
 * Fetch RapidAPI using the **first** configured key only (direct Worker `fetch`).
 * No key rotation and no alternate transports.
 */
export async function rapidApiFetch(
  db: D1Database,
  env: Env,
  url: string,
  host: string,
  scope = host,
  _cycleId?: string,
  statsVariant?: StatisticsVariantDimension,
): Promise<Response> {
  const providerId = providerIdFromScope(scope);
  const keys = parseRapidApiKeys(env);
  if (!keys.length) {
    await log.moderate(
      env,
      scope,
      "RapidAPI key missing",
      { host, scope },
      {
        category: "vendor",
        eventType: "rapidapi_key_missing",
        providerId,
        phase: "rapidApiFetch",
        statusKind: "failed",
      },
    );
    throw new Error("Missing RapidAPI keys: set RAPIDAPI_KEYS or RAPIDAPI_KEY");
  }
  const key = keys[0]!;

  let pathHint = host;
  try {
    pathHint = `${host}${new URL(url).pathname}`;
  } catch {
    /* ignore */
  }
  const requestStartedAtMs = Date.now();
  const transportMeta = {
    providerId,
    scope,
    host,
    target: pathHint,
  };

  await log.debug(env, "rapidapi", "rapidApiFetch", { scope, target: pathHint });
  observabilityLog(
    "debug",
    "rapidapi",
    "RapidAPI request started",
    transportMeta,
    {
      category: "vendor",
      eventType: "rapidapi_request_started",
      providerId,
      phase: "rapidApiFetch",
      statusKind: "running",
    },
  );

  await ensureProviderDailyRequestCapNotReached(db, env, scope);

  let res: Response;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort("rapidapi_timeout"), RAPIDAPI_REQUEST_TIMEOUT_MS);
  try {
    res = await fetch(url, {
      headers: {
        "X-RapidAPI-Key": key,
        "X-RapidAPI-Host": host,
      },
      signal: controller.signal,
    });
  } catch (e) {
    const error =
      controller.signal.aborted
        ? `RapidAPI request timed out after ${RAPIDAPI_REQUEST_TIMEOUT_MS}ms`
        : e instanceof Error
          ? e.message
          : String(e);
    await log.moderate(
      env,
      scope,
      "RapidAPI transport failed",
      {
        ...transportMeta,
        error: error.slice(0, 500),
      },
      {
        category: "vendor",
        eventType: "rapidapi_transport_failed",
        providerId,
        phase: "rapidApiFetch",
        statusKind: "degraded",
      },
    );
    observabilityLog(
      "error",
      "rapidapi",
      "RapidAPI request failed",
      {
        ...transportMeta,
        durationMs: Date.now() - requestStartedAtMs,
        error: error.slice(0, 500),
      },
      {
        category: "vendor",
        eventType: "rapidapi_request_failed",
        providerId,
        phase: "rapidApiFetch",
        statusKind: "degraded",
      },
    );
    throw new Error(error);
  } finally {
    clearTimeout(timeout);
  }
  observabilityLog(
    res.ok ? "debug" : "warn",
    "rapidapi",
    "RapidAPI request completed",
    {
      ...transportMeta,
      status: res.status,
      durationMs: Date.now() - requestStartedAtMs,
    },
    {
      category: "vendor",
      eventType: res.ok ? "rapidapi_request_completed" : "rapidapi_request_http_error",
      providerId,
      phase: "rapidApiFetch",
      statusKind: res.ok ? "ok" : "degraded",
    },
  );
  if (providerId) {
    const requestAt = Math.floor(Date.now() / 1000);
    await bumpProviderUtcDayRequestCount(db, providerId, requestAt);
    try {
      await applyStatisticsDeltas(db, [
        {
          providerId,
          atUnix: requestAt,
          requestCount: 1,
          variant: statsVariant,
        },
      ]);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      await log.moderate(
        env,
        "statistics",
        "Statistics request write failed",
        {
          providerId,
          host,
          scope,
          error: msg.slice(0, 400),
        },
        {
          category: "system",
          eventType: "statistics_request_write_failed",
          providerId,
          phase: "rapidApiFetch",
          statusKind: "degraded",
        },
      );
    }
  }

  const text = await res.text();
  return new Response(text, { status: res.status, headers: res.headers });
}

/** Diagnostics / no-D1 paths: first key only, same as production transport. */
export async function rapidApiFetchFirstKey(env: Env, url: string, host: string): Promise<Response> {
  const keys = parseRapidApiKeys(env);
  if (!keys.length) {
    throw new Error("Missing RapidAPI keys: set RAPIDAPI_KEYS or RAPIDAPI_KEY");
  }
  const key = keys[0]!;
  return fetch(url, {
    headers: {
      "X-RapidAPI-Key": key,
      "X-RapidAPI-Host": host,
    },
  });
}
