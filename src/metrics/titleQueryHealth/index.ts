export { scoreTitleToQueryHealth } from "./scorer";
export { normalizeRoleText, collapseWs, tokenizeNormalized } from "./normalize";
export { parseRoleText, inferRoleFamilies, tokenBaseWeight } from "./parse";
export { getVendorTitleHealthOptions } from "./vendorProfiles";
export { resolveCanonicalSearchRoleForHealth } from "./resolveCanonicalSearchRole";
export type {
  ParsedRoleText,
  RoleFamilyHit,
  TitleQueryHealthBand,
  TitleQueryHealthResult,
  VendorTitleHealthOptions,
  TitleQueryHealthComponentScores,
} from "./types";
