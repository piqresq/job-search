export type ListingLogoKind = "linkedin" | "google" | "other";

/** Classify listing by job/apply URL (not provider `source` alone). */
export function listingLogoFromUrls(jobUrl: string, applyUrl: string): ListingLogoKind {
  const u = `${jobUrl} ${applyUrl}`.toLowerCase();
  if (u.includes("linkedin.com")) return "linkedin";
  if (u.includes("google.com") || u.includes("jobs.google")) return "google";
  return "other";
}
