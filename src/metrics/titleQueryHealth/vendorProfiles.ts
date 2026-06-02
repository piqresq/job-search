import type { VendorTitleHealthOptions } from "./types";

const JSEARCH_QUERY_SUFFIXES = [
  " in united states",
  " in the united states",
  " in united kingdom",
  " in the united kingdom",
  " in germany",
  " in france",
  " in italy",
  " in spain",
  " in netherlands",
  " in poland",
  " in europe",
  " in emea",
  " in latam",
  " in apac",
];

function stripKnownGeoSuffix(raw: string): string {
  let s = raw.trim();
  const lower = s.toLowerCase();
  for (const suf of JSEARCH_QUERY_SUFFIXES) {
    if (lower.endsWith(suf)) {
      s = s.slice(0, -suf.length).trim();
      break;
    }
  }
  return s;
}

/** Optional per-vendor tuning; core scorer stays generic. */
const PROFILES: Record<string, VendorTitleHealthOptions> = {
  jsearch: {
    vendorId: "jsearch",
    canonicalQueryExtractor: stripKnownGeoSuffix,
  },
  linkedin_jobs: { vendorId: "linkedin_jobs" },
  jobs_api: { vendorId: "jobs_api" },
  remote_jobs: { vendorId: "remote_jobs" },
};

export function getVendorTitleHealthOptions(vendorId: string | undefined): VendorTitleHealthOptions | undefined {
  if (!vendorId) return undefined;
  return PROFILES[vendorId];
}
