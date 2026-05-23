/**
 * Daily expiration scan driver.
 *
 * Iterates all active users → pulls board items in scannable columns →
 * fetches each listing URL with humanlike headers → detects expiration →
 * moves expired items to the 'expired' board column.
 *
 * LinkedIn scan path (tiered):
 *   1. getActiveSession() — if null (disabled), skip all LinkedIn jobs this run.
 *   2. First try Worker-IP fetch with stored cookies.
 *   3. If auth_expired → activateBrightdataFallback() + open BD session + switch all
 *      remaining LinkedIn jobs to BD for the rest of the day.
 *   4. If BD also returns auth_expired → invalidateSession() + stop LinkedIn scans.
 *
 * Called from the `scheduled` handler in src/index.ts after the retention
 * purge step. Completely independent of the PIPELINE_QUEUE.
 *
 * Logging policy (per operational-incidents-low-severity rule):
 *   log.info    — scan summary (rows scanned, expired, failed)
 *   log.low     — first BD fallback transition (once per day, in activateBrightdataFallback)
 *   log.moderate — login/session errors, BD auth_expired, fetch retries exhausted, >50% blocked
 *   log.critical — only if the scan itself throws (caller wraps in try/catch)
 */

import { log, observabilityLog } from "../logging/appLog";
import {
  selectBoardItemsForExpirationScan,
  moveBoardItemToExpired,
} from "../db/jobBoard";
import {
  getBoardAutoExpirationCheckEnabled,
  setLastExpirationScanSummary,
} from "../db/appSettings";
import { listActiveUserIds } from "../db/users";
import { fetchPublicListingHtml, normalizeLinkedinJobUrl } from "./listingExpirationFetch";
import { fetchViaBrightdataIsp } from "./brightdataIspFetch";
import { detectExpiration, type JobMetaForDetect, type ExpirationDetectResult } from "./listingExpirationDetect";
import { getPhrasesForCountry } from "./listingExpirationPhrases";
import { pickJsearchApplyUrl } from "../providers/jsearchLinks";
import { retryWithBackoff, classifyAllRetryable } from "./retryWithBackoff";
import {
  getActiveSession,
  isBrightdataFallbackActive,
  activateBrightdataFallback,
  invalidateSession,
  type ActiveSession,
} from "./linkedinSessionService";
import { BrightdataScrapeSession, type ScrapeResult } from "./brightdataScraper";
import type { PublicFetchResult } from "./listingExpirationFetch";

const JITTER_MIN_MS = 200;
const JITTER_RANGE_MS = 600;
const SCOPE = "expiration_scan";

function jitterMs(): number {
  return JITTER_MIN_MS + Math.floor(Math.random() * JITTER_RANGE_MS);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

function isLinkedinSource(source: string): boolean {
  return source === "linkedin_jobs" || source === "jobs_api";
}

type ScanResult = {
  scanned: number;
  expired: number;
  blocked: number;
  transient: number;
  unclear: number;
};

/**
 * Fetch a LinkedIn job listing using Workers native fetch() with the stored
 * li_at cookie, wrapped in retryWithBackoff.
 *
 * Native fetch is preferred for the LinkedIn cookie path because it's free
 * (no proxy cost) and LinkedIn doesn't aggressively bot-block authenticated
 * requests. Non-LinkedIn aggregators that DO bot-block Worker IPs get a BD
 * ISP-proxy fallback in the public-fetch branch above; LinkedIn falls back
 * to the full BD Browser API on auth_expired.
 *
 * timeoutMs is intentionally > FETCH_TIMEOUT_MS (15 s) so the internal
 * AbortController fires first and retryWithBackoff controls retries.
 */
async function fetchViaIsp(
  _env: Env,
  url: string,
  acceptLanguage: string,
  cookieHeader: string,
): Promise<PublicFetchResult> {
  return retryWithBackoff(
    () => fetchPublicListingHtml(url, acceptLanguage, cookieHeader),
    { name: "linkedin_worker_fetch", classify: classifyAllRetryable, timeoutMs: 35_000 },
  );
}

/**
 * Fetch via Bright Data browser session, wrapped in retryWithBackoff.
 */
async function fetchViaBd(
  bdSession: BrightdataScrapeSession,
  url: string,
  acceptLanguage: string,
): Promise<ScrapeResult> {
  return retryWithBackoff(
    () => bdSession.fetch(url, acceptLanguage),
    { name: "linkedin_bd_fetch", classify: classifyAllRetryable, timeoutMs: 15_000 },
  );
}

/**
 * Normalise a ScrapeResult to PublicFetchResult shape so detectExpiration can handle both.
 * BrightdataScrapeSession returns `ScrapeResult` which has the same discriminants we need.
 */
function bdResultToPublicFetchResult(r: ScrapeResult): PublicFetchResult {
  switch (r.kind) {
    case "ok":        return { kind: "ok", status: 200, html: r.html, finalUrl: r.finalUrl, durationMs: 0 };
    case "auth_expired": return { kind: "auth_expired", redirectUrl: r.redirectUrl };
    case "not_found": return { kind: "not_found", status: r.status, finalUrl: r.finalUrl };
    case "transient": return { kind: "transient", error: r.error };
  }
}

/**
 * Run the daily expiration scan for a single user.
 * Returns per-user counts; the caller logs the overall summary.
 */
async function scanForUser(
  env: Env,
  userId: string,
  now: number,
): Promise<ScanResult & { hadFailures: boolean }> {
  const items = await selectBoardItemsForExpirationScan(env.DB, userId);
  if (items.length === 0) {
    return { scanned: 0, expired: 0, blocked: 0, transient: 0, unclear: 0, hadFailures: false };
  }

  // Resolve LinkedIn session once per user scan.
  const session: ActiveSession = await getActiveSession(env);
  const linkedinDisabled = session === null;
  if (linkedinDisabled) {
    // Log once if any LinkedIn job would have been scanned.
    const hasLinkedin = items.some((i) => isLinkedinSource(i.source ?? "linkedin_jobs"));
    if (hasLinkedin) {
      await log.moderate(
        env,
        SCOPE,
        "linkedin_session_disabled: skipping LinkedIn jobs this scan",
        { userId },
        {
          category: "system",
          eventType: "linkedin_session_disabled",
          phase: "scheduled",
          statusKind: "degraded",
        },
      );
    }
  }

  let expired = 0, blocked = 0, transient = 0, unclear = 0;
  let loggedBlockOnce = false;
  // If LinkedIn session is disabled and there are LinkedIn jobs to scan, count
  // that as a failure so the login-banner fires for the user.
  let linkedinSkipped = false;

  // BD session is opened lazily (only if we actually need BD).
  let bdSession: BrightdataScrapeSession | null = null;

  try {
    // Check day-long fallback flag once before the loop.
    let useBdForDay = session ? await isBrightdataFallbackActive(env) : false;

    for (const item of items) {
      await sleep(jitterMs());

      const source = item.source ?? "linkedin_jobs";

      // Determine URL to fetch
      let fetchUrl: string | null | undefined;
      if (source === "jsearch" && item.normalized_json) {
        try {
          const raw = JSON.parse(item.normalized_json) as { raw?: Record<string, unknown> };
          fetchUrl = raw.raw ? pickJsearchApplyUrl(raw.raw) : null;
        } catch {
          fetchUrl = null;
        }
      }
      fetchUrl = fetchUrl || item.apply_url || item.job_url;
      if (!fetchUrl) continue;

      const phraseEntry = getPhrasesForCountry(item.search_country_key);
      const jobMeta: JobMetaForDetect = {
        source,
        company: item.company ?? "",
        countryIso2: item.search_country_key,
      };

      let detection: ExpirationDetectResult;

      if (isLinkedinSource(source)) {
        // ── LinkedIn tiered path ───────────────────────────────────────────────
        // Normalize to www.linkedin.com so the rehydrate-data script returns
        // English strings that LINKEDIN_EXPIRATION_PHRASES can match.
        // Regional subdomains (es., nl., pl., etc.) serve locale-specific copy.
        fetchUrl = normalizeLinkedinJobUrl(fetchUrl);

        if (linkedinDisabled || !session) {
          // Session disabled — skip this job entirely, but flag it so the
          // login-banner fires for the user (they should know a check was skipped).
          unclear++;
          linkedinSkipped = true;
          continue;
        }

        // Open BD session lazily when day-long fallback is active.
        if (useBdForDay && !bdSession) {
          try {
            bdSession = await BrightdataScrapeSession.create(env, session.cookieJar);
          } catch (err) {
            await log.moderate(
              env,
              SCOPE,
              `linkedin_login_bd_connect_failed: cannot open BD scrape session`,
              { error: err instanceof Error ? err.message : String(err) },
              {
                category: "system",
                eventType: "linkedin_login_bd_connect_failed",
                phase: "scheduled",
                statusKind: "degraded",
              },
            );
            // Cannot proceed with BD for remaining LinkedIn jobs.
            break;
          }
        }

        let fetchResult: PublicFetchResult;

        if (bdSession) {
          // Day-long BD fallback path
          const bdResult = await fetchViaBd(bdSession, fetchUrl, "en-US,en;q=0.9").catch(
            (err): ScrapeResult => ({ kind: "transient", error: err instanceof Error ? err.message : String(err) }),
          );
          fetchResult = bdResultToPublicFetchResult(bdResult);

          if (fetchResult.kind === "auth_expired") {
            // BD also got redirected → cookie is truly dead.
            await log.moderate(
              env,
              SCOPE,
              `linkedin_scan_bd_auth_expired: BD fetch also redirected to login`,
              { jobId: item.job_id, redirectUrl: (fetchResult as { redirectUrl: string }).redirectUrl },
              {
                category: "system",
                eventType: "linkedin_scan_bd_auth_expired",
                phase: "scheduled",
                statusKind: "degraded",
              },
            );
            await invalidateSession(env, "bd_fetch_auth_expired");
            // Don't process further LinkedIn jobs this run.
            break;
          }
        } else {
          // Primary path: Workers native fetch() with the stored li_at cookie.
          // ISP proxy sockets cannot complete TLS handshakes to LinkedIn from
          // within Cloudflare Workers, so we use built-in fetch() directly.
          // LinkedIn serves the real job page when a valid li_at is present.
          // Always request en-US for LinkedIn so the rehydrate-data JSON uses
          // English strings that LINKEDIN_EXPIRATION_PHRASES can match.
          const ispResult = await fetchViaIsp(
            env,
            fetchUrl,
            "en-US,en;q=0.9",
            session.cookieHeader,
          ).catch(
            (err): PublicFetchResult => ({ kind: "transient", error: err instanceof Error ? err.message : String(err) }),
          );

          if (ispResult.kind === "auth_expired") {
            // Cookie expired. Switch to BD Browser API (full Chromium with
            // cookies) for the rest of the day — it has stronger fingerprint
            // mimicry and can sometimes still pass through.
            await activateBrightdataFallback(env, item.job_id, ispResult.redirectUrl);
            useBdForDay = true;

            try {
              bdSession = await BrightdataScrapeSession.create(env, session.cookieJar);
            } catch (err) {
              await log.moderate(
                env,
                SCOPE,
                `linkedin_login_bd_connect_failed: cannot open BD session after fallback trigger`,
                { error: err instanceof Error ? err.message : String(err) },
                {
                  category: "system",
                  eventType: "linkedin_login_bd_connect_failed",
                  phase: "scheduled",
                  statusKind: "degraded",
                },
              );
              unclear++;
              continue;
            }

            const bdResult = await fetchViaBd(bdSession, fetchUrl, "en-US,en;q=0.9").catch(
              (err): ScrapeResult => ({ kind: "transient", error: err instanceof Error ? err.message : String(err) }),
            );
            fetchResult = bdResultToPublicFetchResult(bdResult);

            if (fetchResult.kind === "auth_expired") {
              await log.moderate(
                env,
                SCOPE,
                `linkedin_scan_bd_auth_expired: BD fetch also redirected to login`,
                { jobId: item.job_id, redirectUrl: (fetchResult as { redirectUrl: string }).redirectUrl },
                {
                  category: "system",
                  eventType: "linkedin_scan_bd_auth_expired",
                  phase: "scheduled",
                  statusKind: "degraded",
                },
              );
              await invalidateSession(env, "bd_fetch_auth_expired");
              break;
            }
          } else {
            fetchResult = ispResult;
          }
        }

        detection = detectExpiration(fetchResult, jobMeta);

      } else {
        // ── Non-LinkedIn path (JSearch etc.) ─────────────────────────────────
        let fetchResult = await fetchPublicListingHtml(fetchUrl, phraseEntry.acceptLanguage).catch(
          (err): PublicFetchResult => ({ kind: "transient", error: err instanceof Error ? err.message : String(err) }),
        );
        let via = "public";

        // Worker IPs are often bot-challenged by aggregators (recruit.net,
        // indeed mirrors, jobgether mirrors). Fall back to the BD ISP proxy
        // when blocked — it fetches from a residential IP these sites accept.
        if (fetchResult.kind === "blocked") {
          const bdResult = await fetchViaBrightdataIsp(env, fetchUrl, phraseEntry.acceptLanguage).catch(
            (err): PublicFetchResult => ({ kind: "transient", error: err instanceof Error ? err.message : String(err) }),
          );
          if (bdResult.kind !== "blocked") {
            fetchResult = bdResult;
            via = "public_bd";
          } else {
            via = "public_bd_also_blocked";
          }
        }

        detection = detectExpiration(fetchResult, jobMeta);
        // Always emit to Cloudflare Observability so fetch URL + outcome are
        // queryable via MCP regardless of verbose setting.
        observabilityLog("debug", SCOPE, `expiration_scan: ${item.company} → ${detection.status} [${detection.reason}] via=${via}`, {
          jobId: item.job_id,
          title: item.title,
          company: item.company,
          source,
          fetchUrl,
          via,
          fetchKind: fetchResult.kind,
          httpStatus: "status" in fetchResult ? fetchResult.status : undefined,
          fetchError: "error" in fetchResult ? fetchResult.error : undefined,
          detectionStatus: detection.status,
          detectionReason: detection.reason,
        });
      }

      // ── Process detection result ─────────────────────────────────────────────
      switch (detection.status) {
        case "expired":
          expired++;
          await moveBoardItemToExpired(env.DB, userId, item.job_id, now);
          await log.info(
            env,
            SCOPE,
            `Listing expired (scan): ${item.title} at ${item.company} — ${detection.reason}`,
            {
              jobId: item.job_id,
              title: item.title,
              company: item.company,
              source,
              fetchUrl,
              detectionReason: detection.reason,
            },
          );
          break;

        case "auth_expired":
          // Should be handled above (break out of loop); treat as unclear here.
          unclear++;
          break;

        case "blocked":
          blocked++;
          if (!loggedBlockOnce) {
            loggedBlockOnce = true;
            await log.low(
              env,
              SCOPE,
              "Expiration scan: request blocked by bot protection",
              { jobId: item.job_id, reason: detection.reason },
              {
                category: "system",
                eventType: "expiration_scan_block",
                phase: "scheduled",
                statusKind: "degraded",
              },
            );
          }
          break;

        case "transient":
          transient++;
          if (!loggedBlockOnce) {
            loggedBlockOnce = true;
            await log.low(
              env,
              SCOPE,
              "Expiration scan: transient fetch error",
              { jobId: item.job_id, error: detection.reason },
              {
                category: "system",
                eventType: "expiration_scan_block",
                phase: "scheduled",
                statusKind: "degraded",
              },
            );
          }
          break;

        case "unclear":
          unclear++;
          break;

        case "active":
          // nothing to do
          break;
      }
    }
  } finally {
    await bdSession?.close();
  }

  const scanned = items.length;
  const failRate = scanned > 0 ? (blocked + transient) / scanned : 0;
  // hadFailures also covers the case where LinkedIn jobs were silently skipped
  // due to a disabled session — the user should see the login-banner in that case.
  const hadFailures = blocked + transient > 0 || linkedinSkipped;

  if (failRate > 0.5) {
    await log.moderate(
      env,
      SCOPE,
      "Expiration scan: majority of requests blocked or failed",
      { userId, scanned, blocked, transient, failRate: Math.round(failRate * 100) },
      {
        category: "system",
        eventType: "expiration_scan_mostly_blocked",
        phase: "scheduled",
        statusKind: "degraded",
      },
    );
  }

  return { scanned, expired, blocked, transient, unclear, hadFailures };
}

/**
 * Run the daily expiration scan for all active users.
 * Respects the per-user `board_auto_expiration_check_enabled` toggle.
 * Sets `last_failed_expiration_scan_notice_date` for today when any user
 * had blocked/transient failures, so the login banner fires.
 */
export async function runDailyExpirationScan(env: Env, now: number): Promise<void> {
  const userIds = await listActiveUserIds(env.DB);

  let totalScanned = 0, totalExpired = 0, totalBlocked = 0, totalTransient = 0;
  const today = todayUtc();

  for (const userId of userIds) {
    const enabled = await getBoardAutoExpirationCheckEnabled(env.DB, userId);
    if (!enabled) continue;

    const result = await scanForUser(env, userId, now);
    totalScanned += result.scanned;
    totalExpired += result.expired;
    totalBlocked += result.blocked;
    totalTransient += result.transient;

    if (result.scanned > 0) {
      await setLastExpirationScanSummary(env.DB, userId, {
        date: today,
        scanned: result.scanned,
        expired: result.expired,
        failed: result.blocked + result.transient + result.unclear,
      });
    }
  }

  await log.info(env, SCOPE, "Daily expiration scan complete", {
    users: userIds.length,
    scanned: totalScanned,
    expired: totalExpired,
    blocked: totalBlocked,
    transient: totalTransient,
  });
}
