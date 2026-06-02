export type ListingLogoKind =
  | "linkedin"
  | "google"
  | "ashby"
  | "lever"
  | "workable"
  | "greenhouse"
  | "teamtailor"
  | "smartrecruiters"
  | "recruitee"
  | "breezy"
  | "personio"
  | "jazzhr"
  | "jobscore"
  | "rippling"
  | "manatal"
  | "other";

/** Classify listing by job/apply URL (not provider `source` alone). */
export function listingLogoFromUrls(jobUrl: string, applyUrl: string): ListingLogoKind {
  const u = `${jobUrl} ${applyUrl}`.toLowerCase();
  if (u.includes("linkedin.com")) return "linkedin";
  if (u.includes("google.com") || u.includes("jobs.google")) return "google";
  if (u.includes("ashbyhq.com")) return "ashby";
  if (u.includes("lever.co")) return "lever";
  if (u.includes("workable.com")) return "workable";
  if (u.includes("greenhouse.io") || u.includes("greenhouse.com")) return "greenhouse";
  if (u.includes("teamtailor.com")) return "teamtailor";
  if (u.includes("smartrecruiters.com")) return "smartrecruiters";
  if (u.includes("recruitee.com")) return "recruitee";
  if (u.includes("breezy.hr") || u.includes("breezy.co")) return "breezy";
  if (u.includes("personio.")) return "personio";
  if (u.includes("jazz.co") || u.includes("jazzhr.com")) return "jazzhr";
  if (u.includes("jobscore.com")) return "jobscore";
  if (u.includes("rippling.com")) return "rippling";
  if (u.includes("manatal.com")) return "manatal";
  return "other";
}
