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

/**
 * Pipe-separated material before SHA-256 (order: company|title|workplace|country|employmentType|salary).
 * Caller should pass a job with {@link assignWorkplaceTypeToJob} applied so `workplaceType` is set.
 */
export function buildContentDedupeFingerprint(job: NormalizedJob): string {
  const company = seg(job.company);
  const title = seg(job.title);
  const wp = seg(job.workplaceType || "");
  const country = seg(job.country || job.searchCountryLabel || "");
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
