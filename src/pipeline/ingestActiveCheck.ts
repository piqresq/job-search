/**
 * One-time active-listing check at ingest time.
 *
 * Called from processFetchedJobs AFTER AI scoring resolves, before saveScoring.
 * Only runs for high_priority_review and review jobs — low priority and
 * AI-rejected jobs are not checked.
 *
 * Returns active "expired" when the listing is confidently dead (the caller will
 * markHardRejected before the job ever becomes visible in the dashboard).
 * Returns active "skip" for every ambiguous outcome (blocked, transient, unclear,
 * auth_expired, no URL) so the job passes through normally.
 *
 * When the fetch succeeds with HTML, pageHtml is returned for downstream checks
 * (e.g. workplace page verification) without a second fetch.
 *
 * Deliberately no retries and no Bright Data fallback — ingest is not the
 * right place to spend proxy budget on every new job. One attempt is enough:
 * a live listing that happens to be temporarily blocked will pass through and
 * surface in the job list as usual.
 */

import {
  fetchPublicListingHtml,
  normalizeLinkedinJobUrl,
} from "../lib/listingExpirationFetch";
import { detectExpiration, type JobMetaForDetect } from "../lib/listingExpirationDetect";
import { getPhrasesForCountry } from "../lib/listingExpirationPhrases";
import { getActiveSession } from "../lib/linkedinSessionService";
import { pickJsearchApplyUrl } from "../providers/jsearchLinks";
import { observabilityLog } from "../logging/appLog";
import type { NormalizedJob } from "../types/job";

/**
 * Rejection reason string written to hard_reject_reasons.
 * Must match the LIKE pattern in DASHBOARD_FILTERED_REASON_SQL in src/db/jobs.ts.
 */
export const INGEST_EXPIRED_REASON = "Listing no longer active at ingest";

export type IngestListingPageResult = {
  active: "expired" | "skip";
  /** Set when fetch kind === "ok"; reused for workplace page verification. */
  pageHtml: string | null;
  /** True when LinkedIn job-view HTML loaded and expiration detection returned active. */
  pageVerifiedForWorkplaceCheck: boolean;
};

const SCOPE = "ingest_active_check";

function isLinkedinSource(source: string): boolean {
  return source === "linkedin_jobs" || source === "jobs_api";
}

function skipResult(): IngestListingPageResult {
  return { active: "skip", pageHtml: null, pageVerifiedForWorkplaceCheck: false };
}

/**
 * Fetch the listing page and check whether it is still live.
 *
 * @returns active "expired" — confidently dead; caller should hard-reject.
 *          active "skip"    — ambiguous or fetch failed; let the job through.
 *          pageHtml         — HTML body when fetch succeeded with kind "ok".
 */
export async function checkListingActiveAtIngest(
  env: Env,
  job: NormalizedJob,
): Promise<IngestListingPageResult> {
  const source = job.source;

  // Resolve the URL to check
  let fetchUrl: string | null | undefined;
  if (source === "jsearch") {
    fetchUrl = pickJsearchApplyUrl(job.raw) ?? job.applyUrl ?? job.jobUrl;
  } else {
    fetchUrl = job.jobUrl || job.applyUrl;
  }

  if (!fetchUrl) {
    observabilityLog("debug", SCOPE, `${SCOPE}: skipped (no url) — ${job.company}`, {
      source,
      company: job.company,
      title: job.title,
    });
    return skipResult();
  }

  const countryKey = typeof job.searchCountryKey === "string" ? job.searchCountryKey : null;
  const phraseEntry = getPhrasesForCountry(countryKey);
  const jobMeta: JobMetaForDetect = {
    source,
    company: job.company,
    countryIso2: countryKey,
  };

  let fetchResult: Awaited<ReturnType<typeof fetchPublicListingHtml>>;
  let via: string;

  if (isLinkedinSource(source)) {
    fetchUrl = normalizeLinkedinJobUrl(fetchUrl);
    const session = await getActiveSession(env);
    if (!session) {
      observabilityLog("debug", SCOPE, `${SCOPE}: skipped (no linkedin session) — ${job.company}`, {
        source,
        company: job.company,
        title: job.title,
        fetchUrl,
      });
      return skipResult();
    }
    fetchResult = await fetchPublicListingHtml(fetchUrl, "en-US,en;q=0.9", session.cookieHeader).catch(
      (err): typeof fetchResult => ({
        kind: "transient",
        error: err instanceof Error ? err.message : String(err),
      }),
    );
    via = "linkedin_worker";
  } else {
    fetchResult = await fetchPublicListingHtml(fetchUrl, phraseEntry.acceptLanguage).catch(
      (err): typeof fetchResult => ({
        kind: "transient",
        error: err instanceof Error ? err.message : String(err),
      }),
    );
    via = "public";
  }

  const pageHtml = fetchResult.kind === "ok" ? fetchResult.html : null;
  const detection = detectExpiration(fetchResult, jobMeta);

  observabilityLog(
    "debug",
    SCOPE,
    `${SCOPE}: ${job.company} → ${detection.status} [${detection.reason}] via=${via}`,
    {
      source,
      company: job.company,
      title: job.title,
      fetchUrl,
      via,
      fetchKind: fetchResult.kind,
      httpStatus: "status" in fetchResult ? fetchResult.status : undefined,
      fetchError: "error" in fetchResult ? fetchResult.error : undefined,
      detectionStatus: detection.status,
      detectionReason: detection.reason,
      hasPageHtml: pageHtml != null,
    },
  );

  return {
    active: detection.status === "expired" ? "expired" : "skip",
    pageHtml,
    pageVerifiedForWorkplaceCheck: pageHtml != null && detection.status === "active",
  };
}
