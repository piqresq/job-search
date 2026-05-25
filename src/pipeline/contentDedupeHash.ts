import { normalizeEmploymentMatchKey } from "../providers/lib/employmentTypeCanonical";
import type { NormalizedJob } from "../types/job";

function seg(s: string): string {
  return s.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
}

/** Canonical salary segment: structured min/max/currency when possible, else normalized raw text. */
function salarySeg(job: NormalizedJob): string {
  const cur = seg(job.salaryCurrency || "").toUpperCase();
  const min = job.salaryMin;
  const max = job.salaryMax;
  if (typeof min === "number" && Number.isFinite(min) && typeof max === "number" && Number.isFinite(max)) {
    return `${min}|${max}|${cur}`;
  }
  if (typeof min === "number" && Number.isFinite(min)) return `${min}||${cur}`;
  if (typeof max === "number" && Number.isFinite(max)) return `|${max}|${cur}`;
  return seg(job.salaryRaw || "");
}

export function isContentDedupeHashable(job: NormalizedJob): boolean {
  return seg(job.company).length > 0 && seg(job.title).length > 0;
}

function countrySeg(job: NormalizedJob, includeRemoteCountry: boolean): string {
  // Remote listings are often syndicated per country for market reach; keep one canonical copy.
  if (job.workplaceType === "Remote" && !includeRemoteCountry) return "";
  return seg(job.country || job.searchCountryLabel || "");
}

/**
 * Pipe-separated material before SHA-256 (order: company|title|workplace|country|employmentType|salary).
 * For remote listings, country is intentionally blank so per-country reposts dedupe together.
 * Caller should pass a job with {@link assignWorkplaceTypeToJob} applied so `workplaceType` is set.
 */
export function buildContentDedupeFingerprint(job: NormalizedJob): string {
  return buildContentDedupeFingerprintInternal(job, false);
}

function buildContentDedupeFingerprintInternal(job: NormalizedJob, includeRemoteCountry: boolean): string {
  const company = seg(job.company);
  const title = seg(job.title);
  const wp = seg(job.workplaceType || "");
  const country = countrySeg(job, includeRemoteCountry);
  const empRaw = job.employmentType != null ? String(job.employmentType).trim() : "";
  const emp = empRaw ? normalizeEmploymentMatchKey(empRaw) : "";
  const sal = salarySeg(job);
  return [company, title, wp, country, emp, sal].join("|");
}

export async function sha256Hex32Utf8(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  const hex = [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return hex.slice(0, 32);
}

/** 32-char hex digest, or null when company/title are too empty to fingerprint safely. */
export async function computeContentDedupeHash(job: NormalizedJob): Promise<string | null> {
  if (!isContentDedupeHashable(job)) return null;
  return sha256Hex32Utf8(buildContentDedupeFingerprint(job));
}

/**
 * Previous stored hash contract, used only to match older rows whose remote
 * fingerprints still include country.
 */
export async function computeCountryInclusiveContentDedupeHash(job: NormalizedJob): Promise<string | null> {
  if (!isContentDedupeHashable(job)) return null;
  return sha256Hex32Utf8(buildContentDedupeFingerprintInternal(job, true));
}

/** Only rows with created_at within this window can block a newer duplicate listing. */
export const CONTENT_DEDUPE_WINDOW_SECONDS = 7 * 86400;

/** Shown in dashboard filtered-job reject copy when content-hash dedupe hard-rejects a row. */
export const DUPLICATE_LISTING_JOB_ID_LINE_PREFIX = "Duplicate of DB job ID: ";

export function isDuplicateListingRejectText(text: string): boolean {
  return /duplicate listing|content-hash dedupe/i.test(text);
}

export type ContentDedupeAnchorRow = {
  dash_bucket: string | null;
  status: string | null;
  hard_reject_reasons: string | null;
  recommendation: string | null;
};

function parseHardRejectReasonLines(raw: string | null): string[] {
  if (!raw?.trim()) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      return parsed.filter((line): line is string => typeof line === "string");
    }
  } catch {
    /* ignore malformed JSON */
  }
  return [];
}

function normalizedRecommendation(recommendation: string | null): string {
  return (recommendation ?? "").trim().toLowerCase().replace(/\s+/g, "_");
}

/**
 * Rows that may block a newer duplicate: visible on the active job list, or on Filtered
 * for a reason other than content-hash duplicate listing.
 */
export function isContentDedupeAnchorJob(row: ContentDedupeAnchorRow): boolean {
  const bucket = row.dash_bucket ?? "active";
  if (bucket === "accepted" || bucket === "denied") return false;

  const rec = normalizedRecommendation(row.recommendation);
  const status = (row.status ?? "").trim();

  const onActiveList =
    bucket === "active" &&
    (rec === "high_priority_review" || rec === "review" || rec === "low_priority_review");
  if (onActiveList) return true;

  const onFilteredTab =
    bucket === "filtered" ||
    status === "hard_rejected" ||
    status === "rejected_by_ai" ||
    rec === "reject";
  if (!onFilteredTab) return false;

  if (status === "hard_rejected") {
    const rejectLines = parseHardRejectReasonLines(row.hard_reject_reasons);
    if (rejectLines.some(isDuplicateListingRejectText)) return false;
  }

  return true;
}

export function duplicateListingHardRejectReasons(dupOf: string, contentDedupeHash: string): string[] {
  const prefix = contentDedupeHash.slice(0, 8);
  return [
    `Duplicate listing (content-hash dedupe; fingerprint ${prefix}… matches an earlier saved job)`,
    `${DUPLICATE_LISTING_JOB_ID_LINE_PREFIX}${dupOf}`,
  ];
}
