/**
 * Helpers to extract apply / job URLs from a raw JSearch API job record.
 *
 * JSearch returns several URL fields per job:
 *   job_apply_link    — direct apply link (company ATS, or Indeed/LinkedIn redirect)
 *   job_google_link   — Google Jobs aggregator URL
 *   apply_options[]   — array of { publisher, apply_link, is_direct } objects
 *
 * Strategy:
 *   pickJsearchApplyUrl → prefer a direct (is_direct) apply_options link, then
 *                         job_apply_link, then first apply_options link.
 *   pickJsearchJobUrl   → prefer job_google_link (stable aggregator URL for
 *                         deduplication), then fallback to applyUrl.
 */

type ApplyOption = {
  publisher?: unknown;
  apply_link?: unknown;
  is_direct?: unknown;
};

function pickString(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

function parseApplyOptions(raw: unknown): ApplyOption[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((o): o is ApplyOption => o !== null && typeof o === "object");
}

/**
 * Pick the best apply URL from a raw JSearch job record.
 * Prefers a direct (is_direct === true) apply_options link, then job_apply_link,
 * then any apply_options link. Returns undefined if nothing is available.
 */
export function pickJsearchApplyUrl(raw: Record<string, unknown>): string | undefined {
  const options = parseApplyOptions(raw.apply_options);

  // Prefer direct ATS link from apply_options
  for (const opt of options) {
    if (opt.is_direct === true) {
      const link = pickString(opt.apply_link);
      if (link) return link;
    }
  }

  // Fall back to top-level job_apply_link
  const directLink = pickString(raw.job_apply_link);
  if (directLink) return directLink;

  // Fall back to first available apply_options link
  for (const opt of options) {
    const link = pickString(opt.apply_link);
    if (link) return link;
  }

  return undefined;
}

/**
 * Pick the canonical job URL for a JSearch row.
 * Prefers the direct apply URL (same as applyUrl) so the stored jobUrl is
 * human-navigable. Falls back to job_google_link only when no apply link exists.
 * (Content-hash deduplication uses company+title fields, not jobUrl, so URL
 * stability is no longer a reason to prefer the Google aggregator link here.)
 */
export function pickJsearchJobUrl(raw: Record<string, unknown>): string | undefined {
  return pickJsearchApplyUrl(raw) ?? pickString(raw.job_google_link);
}
