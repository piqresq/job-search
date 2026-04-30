export type SearchRoleTierId = 1 | 2;

export type SearchRoleTiers = {
  tier1: string[];
  tier2: string[];
};

export type SearchRoleQueryCache = {
  quotedOr: {
    tier1: string;
    tier2: string;
  };
};

export const DEFAULT_SEARCH_ROLE_TIERS: SearchRoleTiers = {
  tier1: [
    "Technical Customer Success Manager",
    "Customer Success Manager",
    "Technical Account Manager",
    "Key Account Manager",
    "Solutions Consultant",
    "Implementation Consultant",
    "Product Operations Manager",
  ],
  tier2: [
    "Technical Support Manager",
    "Customer Support Manager",
    "Technical Support Specialist",
    "Integration Consultant",
    "Service Delivery Manager",
    "Onboarding Manager",
    "Client Services Manager",
  ],
};

export function normalizeSearchRoleList(input: readonly unknown[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of input) {
    if (typeof raw !== "string") continue;
    const role = raw.replace(/\s+/g, " ").trim();
    if (!role) continue;
    const key = role.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(role);
  }
  return out;
}

export function normalizeSearchRoleTiers(
  input: Partial<SearchRoleTiers> | null | undefined,
  opts?: { fallbackToDefaults?: boolean },
): SearchRoleTiers {
  const fallbackToDefaults = opts?.fallbackToDefaults !== false;
  const tier1 = normalizeSearchRoleList(input?.tier1 ?? []);
  const tier2 = normalizeSearchRoleList(input?.tier2 ?? []);
  return {
    tier1: tier1.length || !fallbackToDefaults ? tier1 : [...DEFAULT_SEARCH_ROLE_TIERS.tier1],
    tier2: tier2.length || !fallbackToDefaults ? tier2 : [...DEFAULT_SEARCH_ROLE_TIERS.tier2],
  };
}

export function quotedRoleOrQuery(roles: readonly string[]): string {
  return roles
    .map((role) => role.replace(/"/g, "").trim())
    .filter(Boolean)
    .map((role) => `"${role}"`)
    .join(" OR ");
}

export function buildSearchRoleQueryCache(tiers: SearchRoleTiers): SearchRoleQueryCache {
  return {
    quotedOr: {
      tier1: quotedRoleOrQuery(tiers.tier1),
      tier2: quotedRoleOrQuery(tiers.tier2),
    },
  };
}
