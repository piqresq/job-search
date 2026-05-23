/**
 * LinkedIn session service — façade for all session management logic.
 *
 * Used by expirationScanner.ts and handleCheckExpired in api.ts.
 *
 * Disable semantics (disabled_until_next_cron):
 *   getActiveSession() returns null immediately.
 *   Only ensureFresh() (called by cron) clears the flag and re-tries login.
 *
 * Bright Data fallback semantics (force_brightdata_scans_until):
 *   Set when first Worker-IP scan returns auth_expired.
 *   All remaining LinkedIn scans that day use BD.
 *   Cleared by ensureFresh() at the next cron so the day starts fresh.
 */

import { log } from "../logging/appLog";
import {
  getLinkedinSession,
  upsertLinkedinSessionActive,
  setLinkedinSessionFailure,
  clearLinkedinSessionDisabled,
  setLinkedinBrightdataFallback,
  clearLinkedinBrightdataFallback,
} from "../db/linkedinSession";
import {
  getLinkedinManualCookie,
  getLinkedinManualCookieSavedAt,
} from "../db/appSettings";
import { performLogin } from "./linkedinAuth";

export type ActiveSession = {
  /** Cookie string ready for the `Cookie:` request header. */
  cookieHeader: string;
  /** Cookie map for CDP/puppeteer setCookies. */
  cookieJar: Record<string, string>;
} | null;

const SCOPE = "linkedin_session";

function buildCookieHeader(cookies: Record<string, string>): string {
  return Object.entries(cookies)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
}

/**
 * Returns the active session for use in Worker-IP fetches.
 *
 * Priority:
 *  1. Manually-set li_at cookie (from Settings → LinkedIn Session) — bypasses auto-login.
 *  2. Auto-login session row from the `linkedin_session` table.
 *
 * Returns null if no usable session is available.
 */
export async function getActiveSession(env: Env): Promise<ActiveSession> {
  // 1. Manual cookie override — takes priority over auto-login session.
  const manualLiAt = await getLinkedinManualCookie(env.DB);
  if (manualLiAt) {
    const cookies = { li_at: manualLiAt };
    return {
      cookieHeader: buildCookieHeader(cookies),
      cookieJar: cookies,
    };
  }

  // 2. Auto-login session.
  const row = await getLinkedinSession(env.DB);
  if (!row) return null;
  if (row.disabledUntilNextCron) return null;
  if (!row.cookies["li_at"]) return null;

  return {
    cookieHeader: buildCookieHeader(row.cookies),
    cookieJar: row.cookies,
  };
}

/**
 * Mark the current session as failed (no longer usable).
 * Logs a moderate incident. Sets disabled_until_next_cron.
 */
export async function invalidateSession(env: Env, reason: string): Promise<void> {
  const row = await getLinkedinSession(env.DB);
  const now = Math.floor(Date.now() / 1000);

  await setLinkedinSessionFailure(
    env.DB,
    "unknown",
    reason,
    { reason, invalidatedAt: now },
    now,
  );

  await log.moderate(
    env,
    SCOPE,
    `linkedin_session_disabled: ${reason}`,
    {
      reason,
      prevStatus: row?.lastStatus ?? null,
      nextRetryAfter: "next daily cron",
    },
    {
      category: "system",
      eventType: "linkedin_session_disabled",
      phase: "scheduled",
      statusKind: "degraded",
    },
  );
}

/**
 * Check whether the Bright Data fallback is currently active for today.
 */
export async function isBrightdataFallbackActive(env: Env): Promise<boolean> {
  const row = await getLinkedinSession(env.DB);
  if (!row) return false;
  const now = Math.floor(Date.now() / 1000);
  return row.forceBrightdataScansUntil > now;
}

/**
 * Activate the day-long Bright Data fallback.
 * Emits one LOW incident per day (only on transition from inactive → active).
 */
export async function activateBrightdataFallback(
  env: Env,
  jobIdTrigger: string,
  redirectUrl: string,
): Promise<void> {
  const alreadyActive = await isBrightdataFallbackActive(env);
  if (alreadyActive) return; // Already set; don't re-log.

  const now = Math.floor(Date.now() / 1000);
  const until = now + 86400;

  await setLinkedinBrightdataFallback(env.DB, until);

  await log.low(
    env,
    SCOPE,
    `linkedin_scan_worker_ip_blocked: switching to Bright Data for the rest of the day`,
    { jobId: jobIdTrigger, redirectUrl, until },
    {
      category: "system",
      eventType: "linkedin_scan_worker_ip_blocked",
      phase: "scheduled",
      statusKind: "degraded",
    },
  );
}

/**
 * Ensure the LinkedIn session is fresh enough for today's scans.
 *
 * Called at the start of the daily cron (after clearing day-long flags).
 * Does nothing if a manual cookie is set (user manages their own session).
 * Does nothing if the session already has a valid li_at with >1 hour remaining.
 * Attempts auto-login via Bright Data ISP proxy if the session is missing or stale.
 * Sets disabled_until_next_cron on any non-recoverable login failure.
 */
export async function ensureFresh(env: Env): Promise<void> {
  // If a manual cookie is set the user manages the session — skip auto-login entirely.
  const manualLiAt = await getLinkedinManualCookie(env.DB);
  if (manualLiAt) {
    const savedAt = await getLinkedinManualCookieSavedAt(env.DB);
    await log.info(
      env,
      SCOPE,
      `linkedin_session: manual cookie active — skipping auto-login`,
      { savedAt },
    );
    return;
  }

  // Clear day-long flags first so we start fresh.
  await clearLinkedinSessionDisabled(env.DB);
  await clearLinkedinBrightdataFallback(env.DB);

  const row = await getLinkedinSession(env.DB);
  const now = Math.floor(Date.now() / 1000);

  // Check if existing li_at is valid for at least 1 more hour.
  const validUntil = (row?.liAtExpiresAt ?? 0) - 3600;
  if (row && !row.disabledUntilNextCron && row.cookies["li_at"] && validUntil > now) {
    // Session is still fresh — nothing to do.
    return;
  }

  const t0 = Date.now();
  const outcome = await performLogin(env);
  const totalDurationMs = Date.now() - t0;

  switch (outcome.kind) {
    case "ok": {
      await upsertLinkedinSessionActive(
        env.DB,
        outcome.cookies,
        outcome.liAtExpiresAt,
        now,
        row?.refreshCount ?? 0,
      );
      await log.info(
        env,
        SCOPE,
        `linkedin_login_ok: session refreshed successfully`,
        {
          refreshCount: (row?.refreshCount ?? 0) + 1,
          liAtExpiresAt: outcome.liAtExpiresAt,
          via: "brightdata",
        },
      );
      break;
    }

    case "challenged": {
      await setLinkedinSessionFailure(
        env.DB,
        "challenged",
        "login_challenged",
        {
          checkpointType: outcome.checkpointType,
          finalUrl: outcome.finalUrl,
          bodyPreview: outcome.bodyPreview,
          cookieKeys: outcome.cookieKeys,
        },
        now,
      );
      await log.moderate(
        env,
        SCOPE,
        `linkedin_login_challenged: checkpoint challenge at ${outcome.finalUrl}`,
        {
          checkpointType: outcome.checkpointType,
          finalUrl: outcome.finalUrl,
          bodyPreview: outcome.bodyPreview,
          cookieKeys: outcome.cookieKeys,
        },
        {
          category: "system",
          eventType: "linkedin_login_challenged",
          phase: "scheduled",
          statusKind: "degraded",
        },
      );
      break;
    }

    case "bad_credentials": {
      await setLinkedinSessionFailure(
        env.DB,
        "bad_credentials",
        "login_bad_credentials",
        { finalUrl: outcome.finalUrl, errorText: outcome.errorText },
        now,
      );
      await log.moderate(
        env,
        SCOPE,
        `linkedin_login_bad_credentials: ${outcome.errorText}`,
        { finalUrl: outcome.finalUrl, errorText: outcome.errorText },
        {
          category: "system",
          eventType: "linkedin_login_bad_credentials",
          phase: "scheduled",
          statusKind: "degraded",
        },
      );
      break;
    }

    case "transient": {
      await setLinkedinSessionFailure(
        env.DB,
        "transient",
        "login_transient_exhausted",
        { lastError: outcome.reason, attempts: outcome.attempts, totalDurationMs },
        now,
      );
      await log.moderate(
        env,
        SCOPE,
        `linkedin_login_transient: all retries exhausted`,
        { lastError: outcome.reason, attempts: outcome.attempts, totalDurationMs },
        {
          category: "system",
          eventType: "linkedin_login_transient",
          phase: "scheduled",
          statusKind: "degraded",
        },
      );
      break;
    }

    case "unknown_state": {
      await setLinkedinSessionFailure(
        env.DB,
        "unknown",
        "login_unknown_state",
        { finalUrl: outcome.finalUrl, bodyPreview: outcome.bodyPreview, title: outcome.title },
        now,
      );
      await log.moderate(
        env,
        SCOPE,
        `linkedin_login_unknown_state: unexpected post-login page`,
        {
          finalUrl: outcome.finalUrl,
          bodyPreview: outcome.bodyPreview,
          title: outcome.title,
        },
        {
          category: "system",
          eventType: "linkedin_login_unknown_state",
          phase: "scheduled",
          statusKind: "degraded",
        },
      );
      break;
    }
  }
}
