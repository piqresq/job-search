export type SearchEmploymentMode = "fulltime";
export type SearchRecencyMode = "last_24h";

export type SearchRuntimePolicy = {
  remoteOnly: boolean;
  employmentMode: SearchEmploymentMode;
  recencyMode: SearchRecencyMode;
};

export const DEFAULT_SEARCH_RUNTIME_POLICY: SearchRuntimePolicy = {
  remoteOnly: true,
  employmentMode: "fulltime",
  recencyMode: "last_24h",
};

export function normalizeSearchRuntimePolicy(
  input: Partial<SearchRuntimePolicy> | {
    remoteOnly?: boolean | string | null;
    employmentMode?: string | null;
    recencyMode?: string | null;
  },
): SearchRuntimePolicy {
  const remoteRaw = input.remoteOnly;
  const remoteOnly =
    typeof remoteRaw === "boolean"
      ? remoteRaw
      : typeof remoteRaw === "string"
        ? ["1", "true", "yes"].includes(remoteRaw.trim().toLowerCase())
        : DEFAULT_SEARCH_RUNTIME_POLICY.remoteOnly;
  const employmentMode =
    input.employmentMode === "fulltime"
      ? input.employmentMode
      : DEFAULT_SEARCH_RUNTIME_POLICY.employmentMode;
  const recencyMode =
    input.recencyMode === "last_24h"
      ? input.recencyMode
      : DEFAULT_SEARCH_RUNTIME_POLICY.recencyMode;
  return { remoteOnly, employmentMode, recencyMode };
}

export function linkedinTypeFilterForPolicy(policy: SearchRuntimePolicy): string {
  switch (policy.employmentMode) {
    case "fulltime":
    default:
      return "FULL_TIME";
  }
}

export function jsearchEmploymentTypesForPolicy(policy: SearchRuntimePolicy): "FULLTIME" | "PARTTIME" {
  switch (policy.employmentMode) {
    case "fulltime":
    default:
      return "FULLTIME";
  }
}

export function jobsApiEmploymentTypesForPolicy(policy: SearchRuntimePolicy): string {
  switch (policy.employmentMode) {
    case "fulltime":
    default:
      return "fulltime";
  }
}

export function linkedinPathForPolicy(policy: SearchRuntimePolicy): string {
  switch (policy.recencyMode) {
    case "last_24h":
    default:
      return "/active-jb-24h";
  }
}

export function jsearchDatePostedForPolicy(policy: SearchRuntimePolicy): string {
  switch (policy.recencyMode) {
    case "last_24h":
    default:
      return "today";
  }
}

export function jobsApiDatePostedForPolicy(policy: SearchRuntimePolicy): string {
  switch (policy.recencyMode) {
    case "last_24h":
    default:
      return "day";
  }
}

export function jobsApiWorkplaceTypesForPolicy(policy: SearchRuntimePolicy): string {
  return policy.remoteOnly ? "remote" : "remote;hybrid;onSite";
}
