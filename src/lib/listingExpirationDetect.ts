/**
 * Pure (no I/O) expiration detection logic.
 *
 * Consumes a PublicFetchResult + job metadata and returns a classification:
 *   expired   — confidently expired (phrase match / 404 / 410 / no company name)
 *   active    — page loaded and no expiration signals found
 *   unclear   — page loaded but we cannot be confident (e.g. company name not found
 *               but no expiration phrases either — could be a rebrand or redirect)
 *   blocked   — request was challenged / rate-limited; result unknown
 *   transient — network/server error; result unknown
 *
 * Per-source strategies:
 *   linkedin_jobs / jobs_api: phrase-based on LinkedIn listing page HTML.
 *   jsearch: 2-stage — company-name probe first, then country-hinted phrase probe.
 */

import type { PublicFetchResult } from "./listingExpirationFetch";
import {
  LINKEDIN_EXPIRATION_PHRASES,
  UNIVERSAL_EXPIRATION_PHRASES, // used by detectJsearch
  getPhrasesForCountry,
  htmlContainsAnyPhrase,
} from "./listingExpirationPhrases";

export type ExpirationStatus = "expired" | "active" | "unclear" | "blocked" | "transient" | "auth_expired";

export type ExpirationDetectResult = {
  status: ExpirationStatus;
  reason: string;
};

/** Job metadata fields needed for detection. */
export type JobMetaForDetect = {
  source: string;
  company: string;
  /** ISO2 country code stored on the job (e.g. "DE", "GB"). */
  countryIso2?: string | null;
};

// ─── Company name normalization ───────────────────────────────────────────────

const COMPANY_SUFFIX_RE =
  /\b(inc|corp|corporation|llc|ltd|limited|gmbh|ag|bv|sa|sas|srl|nv|oy|as|ab|plc|group|holding|holdings|co)\b\.?/gi;

/**
 * Strips diacritics, punctuation, common corporate suffixes, and collapses
 * whitespace to produce a token suitable for `includes()` checks.
 */
function normalizeCompanyName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(COMPANY_SUFFIX_RE, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// ─── LinkedIn / jobs_api ──────────────────────────────────────────────────────

/**
 * Returns true if the final URL still looks like a LinkedIn job-view page.
 * LinkedIn redirects unauthenticated server requests to /authwall, /login,
 * /signup, etc. — those pages are NOT the job listing and must not be scanned
 * for expiration phrases.
 */
function isLinkedinJobPage(finalUrl: string): boolean {
  try {
    const u = new URL(finalUrl);
    return u.hostname.endsWith("linkedin.com") && u.pathname.includes("/jobs/view/");
  } catch {
    return false;
  }
}

function detectLinkedin(result: PublicFetchResult): ExpirationDetectResult {
  if (result.kind === "not_found") {
    return { status: "expired", reason: `HTTP ${result.status}` };
  }
  if (result.kind === "expired") {
    return { status: "expired", reason: result.reason };
  }
  if (result.kind === "auth_expired") {
    return { status: "auth_expired", reason: `linkedin redirected to ${result.redirectUrl}` };
  }
  if (result.kind === "blocked") {
    return { status: "blocked", reason: `blocked:${result.reason}` };
  }
  if (result.kind === "transient") {
    return { status: "transient", reason: result.error };
  }

  // If LinkedIn redirected us away from the /jobs/view/ path (auth wall, login
  // page, signup page) we cannot determine expiration — return unclear, not expired.
  if (!isLinkedinJobPage(result.finalUrl)) {
    return { status: "unclear", reason: "redirected off linkedin job page" };
  }

  // Only check LinkedIn-specific phrases.
  // Universal phrases (e.g. "not found", "404") are deliberately excluded here:
  // LinkedIn auth-wall and login pages contain these and cause false positives.
  //
  // IMPORTANT: do NOT strip scripts for LinkedIn. LinkedIn's authenticated SSR
  // places the closed-job signal ("No longer accepting applications") inside
  // the React hydration <script id="rehydrate-data"> JSON blob, NOT in the
  // visible DOM body. Stripping scripts would delete the only reliable signal.
  // The LINKEDIN_EXPIRATION_PHRASES set is narrow enough that false positives
  // from LinkedIn's JS bundles are essentially impossible.
  const foundInRaw = htmlContainsAnyPhrase(result.html, LINKEDIN_EXPIRATION_PHRASES, { skipStrip: true });
  if (foundInRaw) {
    // Also check whether the phrase was only in a script/style/form (debug info).
    const foundInStripped = htmlContainsAnyPhrase(result.html, LINKEDIN_EXPIRATION_PHRASES);
    const location = foundInStripped ? "visible-dom" : "script-rehydration-data";
    return { status: "expired", reason: `linkedin expiration phrase found (${location})` };
  }
  return { status: "active", reason: "no expiration signals in raw html" };
}

// ─── JSearch ──────────────────────────────────────────────────────────────────

function detectJsearch(result: PublicFetchResult, job: JobMetaForDetect): ExpirationDetectResult {
  if (result.kind === "not_found") {
    return { status: "expired", reason: `HTTP ${result.status}` };
  }
  if (result.kind === "expired") {
    return { status: "expired", reason: result.reason };
  }
  if (result.kind === "auth_expired") {
    return { status: "auth_expired", reason: `redirected to ${result.redirectUrl}` };
  }
  if (result.kind === "blocked") {
    return { status: "blocked", reason: `blocked:${result.reason}` };
  }
  if (result.kind === "transient") {
    return { status: "transient", reason: result.error };
  }

  // ok — 2-stage detection
  const html = result.html;
  const lower = html.toLowerCase();

  // Stage 1: company-name probe
  const normalizedCompany = normalizeCompanyName(job.company);
  if (normalizedCompany.length >= 3 && !lower.includes(normalizedCompany)) {
    // Company name not on page — likely a dead link / generic error page
    // But use "unclear" instead of "expired" to be conservative (company may have
    // rebranded or the ATS may show a different entity name).
    return { status: "unclear", reason: "company name not found on page" };
  }

  // Stage 2: country-hinted phrase probe
  const phraseEntry = getPhrasesForCountry(job.countryIso2);
  if (htmlContainsAnyPhrase(html, phraseEntry.phrases)) {
    return { status: "expired", reason: `expiration phrase found (${job.countryIso2 ?? "en"})` };
  }
  if (htmlContainsAnyPhrase(html, UNIVERSAL_EXPIRATION_PHRASES)) {
    return { status: "expired", reason: "universal expiration phrase found" };
  }

  return { status: "active", reason: "no expiration signals" };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Classify whether a job listing has expired based on the fetched HTML and
 * per-source detection strategy.
 */
export function detectExpiration(
  result: PublicFetchResult,
  job: JobMetaForDetect,
): ExpirationDetectResult {
  const src = job.source;
  if (src === "linkedin_jobs" || src === "jobs_api") {
    return detectLinkedin(result);
  }
  if (src === "jsearch") {
    return detectJsearch(result, job);
  }
  // Unknown source — fall back to LinkedIn strategy (phrase-only)
  return detectLinkedin(result);
}
