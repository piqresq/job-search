import { DEFAULT_SEARCH_ROLE_TIERS, quotedRoleOrQuery } from "./searchRoles";

/**
 * Default Fantastic Jobs `title_filter` (Google-like syntax with quoted phrases + OR).
 * Override with env `LINKEDIN_TITLE_FILTER` if needed.
 */
export const DEFAULT_LINKEDIN_TITLE_FILTER = quotedRoleOrQuery([
  ...DEFAULT_SEARCH_ROLE_TIERS.tier1,
]);
