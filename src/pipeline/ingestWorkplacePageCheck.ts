/**
 * Ingest-time workplace verification against the live LinkedIn listing page.
 *
 * After the active-listing check passes, Jobs API jobs with a resolved workplace
 * type are checked against HTML from the same fetch. Only hard-reject when
 * structured listing workplace signals explicitly confirm a different type;
 * absent or ambiguous page wording → skip (do not filter).
 */

import {
  textConfirmsWorkplaceType,
  type CanonicalWorkplaceType,
} from "../providers/lib/workplaceTypeCanonical";
import type { NormalizedJob } from "../types/job";

/**
 * Prefix written to hard_reject_reasons; full reason appends workplace type in parens.
 * Dashboard filter SQL uses a shorter LIKE substring (D1 rejects overlong patterns):
 * `%workplace not confirmed on listing page%`.
 */
export const INGEST_WORKPLACE_PAGE_MISMATCH_PREFIX =
  "Jobs API: workplace not confirmed on listing page at ingest";

export function ingestWorkplacePageMismatchReason(workplaceType: CanonicalWorkplaceType): string {
  return `${INGEST_WORKPLACE_PAGE_MISMATCH_PREFIX} (${workplaceType})`;
}

export function pageConfirmsWorkplaceType(
  html: string,
  workplaceType: CanonicalWorkplaceType,
): boolean {
  return textConfirmsWorkplaceType(html, workplaceType);
}

const ALL_WORKPLACE_TYPES: readonly CanonicalWorkplaceType[] = ["Remote", "Hybrid", "Office"];

/** True when the blob mentions remote, hybrid, or on-site/office workplace signals. */
export function pageMentionsAnyWorkplaceType(html: string): boolean {
  return ALL_WORKPLACE_TYPES.some((t) => textConfirmsWorkplaceType(html, t));
}

/** True when the blob explicitly confirms a workplace type other than `expected`. */
export function pageConfirmsConflictingWorkplaceType(
  html: string,
  expected: CanonicalWorkplaceType,
): boolean {
  return ALL_WORKPLACE_TYPES.some(
    (t) => t !== expected && textConfirmsWorkplaceType(html, t),
  );
}

/** LinkedIn embeds + visible criteria chips — not full-page nav/footer/description text. */
const LISTING_WORKPLACE_JSON_PATTERNS: readonly RegExp[] = [
  /"workplaceTypes"\s*:\s*\[([\s\S]*?)\]/gi,
  /"workplaceType"\s*:\s*"([^"]+)"/gi,
  /"workplaceTypes"\s*:\s*"([^"]+)"/gi,
  /"jobLocationType"\s*:\s*"([^"]+)"/gi,
  /"formattedWorkplaceType"\s*:\s*"([^"]+)"/gi,
  /"localizedWorkplaceType"\s*:\s*"([^"]+)"/gi,
  /"workRemoteAllowed"\s*:\s*(true|false)/gi,
];

const LISTING_WORKPLACE_CHIP_RE =
  />\s*(Remote|Hybrid|On[-\s]?site|Onsite|Telecommute|Télétravail|Teletravail)\s*</gi;

/**
 * Extract workplace-type signals from a LinkedIn job-view page without scanning
 * unrelated page text (nav, related jobs, office location metadata, etc.).
 */
export function extractLinkedInListingWorkplaceBlob(html: string): string | null {
  const parts: string[] = [];
  for (const re of LISTING_WORKPLACE_JSON_PATTERNS) {
    re.lastIndex = 0;
    for (const m of html.matchAll(re)) {
      const g = m[1];
      if (g) parts.push(g.replace(/"/g, " "));
    }
  }
  LISTING_WORKPLACE_CHIP_RE.lastIndex = 0;
  for (const m of html.matchAll(LISTING_WORKPLACE_CHIP_RE)) {
    const g = m[1];
    if (g) parts.push(g);
  }
  const blob = parts.join(" ").replace(/\s+/g, " ").trim();
  return blob.length > 0 ? blob : null;
}

export type IngestWorkplacePageCheckResult = "reject" | "skip" | "pass";

/**
 * Compare resolved workplace type to listing page HTML.
 *
 * - skip: not jobs_api, no HTML, no workplaceType on job, or listing omits workplace signals
 * - reject: listing explicitly states a different workplace type than the job's resolved type
 * - pass: listing confirms the job's workplace type, or check skipped
 */
export function checkWorkplaceOnPageAtIngest(
  job: NormalizedJob,
  pageHtml: string | null | undefined,
): IngestWorkplacePageCheckResult {
  if (job.source !== "jobs_api") return "skip";
  if (!pageHtml || !pageHtml.trim()) return "skip";

  const wp = job.workplaceType;
  if (wp !== "Remote" && wp !== "Hybrid" && wp !== "Office") return "skip";

  const workplaceBlob = extractLinkedInListingWorkplaceBlob(pageHtml);
  if (!workplaceBlob) return "skip";

  if (pageConfirmsWorkplaceType(workplaceBlob, wp)) return "pass";
  if (pageConfirmsConflictingWorkplaceType(workplaceBlob, wp)) return "reject";
  return "skip";
}
