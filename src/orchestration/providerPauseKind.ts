/**
 * Classifies why a provider chunk reported {@link ProviderChunkResult.doneForCycle},
 * using `meta` from the provider (see `runPlannedSearchProvider`, LinkedIn, `rapidApiFetch`).
 */
export type ProviderPauseKind =
  | "request_cap"
  | "vendor_quota"
  | "sources_exhausted"
  | "schedule_wait"
  | "unknown";

export function deriveProviderPauseKind(
  meta: Record<string, unknown> | undefined,
  doneForCycle: boolean,
): ProviderPauseKind | null {
  if (!doneForCycle) return null;
  if (!meta) return "unknown";

  const r = meta.reason;
  if (r === "provider_request_cap" || r === "remote_jobs_sweep_request_cap") return "request_cap";
  if (
    r === "vendor_quota_exhausted" ||
    r === "provider_monthly_request_cap" ||
    r === "remote_jobs_monthly_request_cap"
  ) {
    return "vendor_quota";
  }
  if (r === "remote_jobs_cadence_wait") return "schedule_wait";
  if (
    r === "provider_exhausted" ||
    r === "attempt_budget_exhausted" ||
    r === "no_countries_or_queries" ||
    r === "linkedin_listings_exhausted"
  ) {
    return "sources_exhausted";
  }
  if (r === "linkedin_freeze_wait") return "schedule_wait";

  // Planned-search: finished cycle with jobs, all countries exhausted (meta has country, no reason).
  if (typeof meta.country === "string" && (r === undefined || r === null)) {
    return "sources_exhausted";
  }

  // Legacy LinkedIn single-country path: short page / pool rotation (no `reason` field).
  if (typeof meta.locationFilter === "string" && (r === undefined || r === null)) {
    return "sources_exhausted";
  }

  return "unknown";
}
