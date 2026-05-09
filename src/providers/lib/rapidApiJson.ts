import type { StatisticsVariantDimension } from "../../db/statistics";
import { nextUtcMidnightUnix } from "../../lib/nextUtcMidnight";
import { rapidApiFetch } from "../rapidapiFetch";
import { PlannedSearchBackoffError, PlannedSearchDoneForCycleError } from "./plannedSearch";

function retryAfterSeconds(headers: Headers): number | undefined {
  const raw = headers.get("retry-after");
  if (!raw) return undefined;
  const seconds = parseInt(raw, 10);
  if (Number.isFinite(seconds) && seconds > 0) return seconds;
  const when = Date.parse(raw);
  if (!Number.isNaN(when)) {
    return Math.max(30, Math.ceil((when - Date.now()) / 1000));
  }
  return undefined;
}

/**
 * Body snippets that indicate the plan's *billing-period* budget is gone until next reset
 * (typically next UTC month on RapidAPI) — retrying every 5 min all day just wastes API
 * accounting and fills logs. Matched across 402, 403 and 429 because RapidAPI uses all
 * three for monthly-quota exhaustion depending on the underlying API's implementation.
 */
function looksLikePersistentQuotaBody(preview: string): boolean {
  const text = preview.toLowerCase();
  return (
    text.includes("monthly quota") ||
    text.includes("upgrade your plan") ||
    text.includes("upgrade plan") ||
    text.includes("subscription") ||
    text.includes("billing") ||
    text.includes("plan limit") ||
    text.includes("quota exceeded")
  );
}

export function isPersistentVendorQuotaStatus(status: number, preview: string): boolean {
  if (status === 402) return true;
  if (status === 403) return looksLikePersistentQuotaBody(preview);
  // Observed with jobs_api (RapidAPI Pat92/jobs-api14) when the monthly quota is exhausted —
  // returned as HTTP 429 with an "exceeded the MONTHLY quota / upgrade your plan" body.
  // Previously fell through to transient 300s backoff and hammered the endpoint all day.
  if (status === 429) return looksLikePersistentQuotaBody(preview);
  return false;
}

export function isTransientVendorLimitStatus(status: number, preview: string): boolean {
  // Persistent billing-period exhaustion wins — a 403 "upgrade your plan" or 429 "MONTHLY
  // quota" should never fall back to 300s transient backoff. Keep these branches mutually
  // exclusive so callers that check them independently still agree with rapidApiJsonRequest.
  if (isPersistentVendorQuotaStatus(status, preview)) return false;
  if (status === 429) return true;
  if (status !== 403) return false;
  const text = preview.toLowerCase();
  return (
    text.includes("credit") ||
    text.includes("limit") ||
    text.includes("quota") ||
    text.includes("exceed") ||
    text.includes("rate limit") ||
    text.includes("too many requests")
  );
}

export async function rapidApiJsonRequest(
  db: D1Database,
  env: Env,
  userId: string,
  url: string,
  host: string,
  scope: string,
  cycleId?: string,
  statsVariant?: StatisticsVariantDimension,
): Promise<unknown> {
  const res = await rapidApiFetch(db, env, userId, url, host, scope, cycleId, statsVariant);
  const text = await res.text();
  if (!res.ok) {
    const preview = text.slice(0, 500);
    if (isPersistentVendorQuotaStatus(res.status, preview)) {
      const nextEligibleAt = nextUtcMidnightUnix(Math.floor(Date.now() / 1000));
      throw new PlannedSearchDoneForCycleError(
        `${scope} HTTP ${res.status}: ${preview}`,
        nextEligibleAt,
        {
          reason: "vendor_quota_exhausted",
          httpStatus: res.status,
          nextEligibleAt,
        },
      );
    }
    if (isTransientVendorLimitStatus(res.status, preview)) {
      throw new PlannedSearchBackoffError(
        `${scope} HTTP ${res.status}: ${preview}`,
        retryAfterSeconds(res.headers),
      );
    }
    throw new Error(`${scope} HTTP ${res.status}: ${preview}`);
  }
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    throw new Error(`${scope} returned non-JSON response: ${msg}; preview=${text.slice(0, 200)}`);
  }
}
