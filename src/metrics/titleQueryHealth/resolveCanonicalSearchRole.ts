import type { NormalizedJob } from "../../types/job";

/** Intended role string for title↔query health (never vendor-decorated transport). */
export function resolveCanonicalSearchRoleForHealth(
  job: Pick<NormalizedJob, "canonicalSearchRole" | "searchQuery">,
): string {
  const c = typeof job.canonicalSearchRole === "string" ? job.canonicalSearchRole.trim() : "";
  if (c) return c;
  return typeof job.searchQuery === "string" ? job.searchQuery.trim() : "";
}
