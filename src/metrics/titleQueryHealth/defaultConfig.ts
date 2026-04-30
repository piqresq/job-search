/**
 * Default deterministic config for title↔query health.
 * Tune via {@link VendorTitleHealthOptions} per vendor without changing core logic.
 */

import type { RoleHeadMismatchRule } from "./types";

/** Strong noise: strip / ignore for overlap (not discriminative). */
export const DEFAULT_NOISE_STRONG = new Set<string>([
  "junior",
  "jr",
  "senior",
  "sr",
  "lead",
  "principal",
  "staff",
  "head",
  "mid",
  "midlevel",
  "mid-level",
  "entry",
  "level",
  "full",
  "time",
  "fulltime",
  "full-time",
  "part",
  "parttime",
  "part-time",
  "contract",
  "freelance",
  "temporary",
  "temp",
  "internship",
  "intern",
  "permanent",
  "remote",
  "hybrid",
  "onsite",
  "on-site",
  "emea",
  "europe",
  "eastern",
  "western",
  "germany",
  "france",
  "italy",
  "spain",
  "united",
  "states",
  "usa",
  "uk",
  "kingdom",
  "latam",
  "apac",
  "netherlands",
  "poland",
  "milan",
  "rome",
  "berlin",
  "london",
  "hiring",
  "now",
  "urgent",
  "urgently",
  "immediate",
  "start",
  "all",
  "genders",
  "mfd",
  "m/f/d",
  "m/w/d",
]);

/** Weak noise / fluff: keep token but downweight in title expansion logic. */
export const DEFAULT_NOISE_WEAK = new Set<string>([
  "team",
  "office",
  "global",
  "regional",
  "strategic",
  "enterprise",
  "commercial",
  "group",
  "division",
  "department",
  "eastern",
  "western",
  "north",
  "south",
  "aerospace",
  "defense",
  "defence",
]);

/** Generic role-head tokens: must not alone drive a high score. */
export const DEFAULT_GENERIC_TOKENS = new Set<string>([
  "manager",
  "director",
  "specialist",
  "associate",
  "consultant",
  "engineer",
  "analyst",
  "representative",
  "rep",
  "coordinator",
  "executive",
  "officer",
  "lead",
  "partner",
  "advisor",
  "architect",
  "developer",
  "lawyer",
  "counsel",
  "recruiter",
  "nurse",
]);

/**
 * Extra discriminative weight for tokens that often carry meaning beyond generic heads.
 * Values > 1 boost required match quality slightly.
 */
export const DEFAULT_TOKEN_WEIGHT_BOOST: Record<string, number> = {
  account: 1.35,
  accounts: 1.35,
  key: 1.1,
  integration: 1.45,
  integrations: 1.45,
  implementation: 1.35,
  support: 1.35,
  customer: 1.15,
  technical: 1.2,
  operations: 1.35,
  operation: 1.25,
  onboarding: 1.35,
  product: 1.25,
  sales: 1.25,
  success: 1.25,
  project: 1.2,
  solutions: 1.25,
  solution: 1.2,
  workflow: 1.15,
  data: 1.2,
  platform: 1.2,
  devops: 1.25,
  site: 1.05,
  reliability: 1.25,
  sre: 1.3,
  people: 1.2,
  hr: 1.25,
  finance: 1.2,
  fpa: 1.35,
  fp: 1.1,
  legal: 1.25,
  contracts: 1.2,
  commercial: 1.05,
  cloud: 1.05,
  oic: 1.05,
  experience: 1.05,
  customerexperience: 1.1,
};

/** Conservative synonyms: token -> equivalent surface forms (all normalized). */
export const DEFAULT_SYNONYMS: Record<string, readonly string[]> = {
  consultant: ["specialist", "advisor"],
  specialist: ["consultant", "advisor"],
  advisor: ["consultant", "specialist"],
  implementation: ["implementations"],
  integration: ["integrations"],
  devops: ["devops"],
  engineer: ["engineering"],
  engineering: ["engineer"],
  hr: ["people"],
  people: ["hr", "human"],
  recruiter: ["talent", "recruiting"],
  /** Corporate finance / planning umbrella (not example-specific; used for FP&A vs finance analyst, etc.). */
  finance: ["fpa", "fp", "financial"],
  financial: ["finance", "fpa", "fp"],
  fpa: ["fp", "financial", "finance"],
  fp: ["fpa", "finance"],
  lawyer: ["counsel", "attorney"],
  counsel: ["lawyer", "attorney"],
  contracts: ["legal"],
  nurse: ["rn", "nursing"],
};

/**
 * Token adjacency: conservative. Adjacent matches only apply when core lexical corroboration exists
 * (see scorer). Avoid loose bridges that inflate unrelated titles.
 */
export const DEFAULT_ADJACENCY: Record<string, readonly string[]> = {
  /** Narrow bridge: only when scorer enables adjacency after core corroboration. */
  integration: ["implementation", "solutions", "solution", "technical"],
  technical: ["integration"],
  implementation: ["integration", "onboarding", "solutions"],
  onboarding: ["implementation"],
  consultant: ["specialist", "advisor"],
  devops: ["sre", "reliability", "platform"],
  sre: ["reliability", "devops", "platform"],
  data: ["platform", "analytics"],
  hr: ["people", "operations"],
  people: ["hr", "operations"],
  finance: ["fpa", "fp"],
  fpa: ["finance", "fp"],
  legal: ["counsel", "lawyer", "contracts"],
  contracts: ["legal"],
};

/**
 * Role family adjacency for component C (0..2). Pairs are symmetric; strength 0..1.
 */
export const DEFAULT_FAMILY_ADJACENCY: ReadonlyArray<{
  a: string;
  b: string;
  strength: number;
}> = [
  { a: "customer_support", b: "technical_support", strength: 0.55 },
  { a: "customer_success", b: "account_management", strength: 0.45 },
  { a: "implementation", b: "integration", strength: 0.65 },
  { a: "implementation", b: "onboarding", strength: 0.4 },
  { a: "integration", b: "solutions_consulting", strength: 0.55 },
  { a: "implementation", b: "solutions_consulting", strength: 0.5 },
  { a: "product", b: "operations", strength: 0.35 },
  { a: "engineering", b: "data_engineering", strength: 0.65 },
  { a: "engineering", b: "platform_engineering", strength: 0.65 },
  { a: "engineering", b: "devops_sre", strength: 0.55 },
  { a: "data_engineering", b: "platform_engineering", strength: 0.55 },
  { a: "devops_sre", b: "platform_engineering", strength: 0.6 },
  { a: "hr_people", b: "operations", strength: 0.25 },
  { a: "finance", b: "operations", strength: 0.2 },
];

/** Explicit low-similarity family pairs (used for penalties / low C). */
export const DEFAULT_FAMILY_CONFLICT: ReadonlyArray<{ a: string; b: string; weight: number }> = [
  { a: "sales", b: "customer_support", weight: 1 },
  { a: "sales", b: "technical_support", weight: 1 },
  { a: "sales", b: "account_management", weight: 0.85 },
  { a: "engineering", b: "customer_support", weight: 1 },
  { a: "engineering", b: "customer_success", weight: 0.75 },
  { a: "product", b: "customer_support", weight: 0.85 },
  { a: "product", b: "technical_support", weight: 0.75 },
  { a: "account_management", b: "engineering", weight: 0.85 },
  { a: "sales", b: "engineering", weight: 1 },
  { a: "hr_people", b: "sales", weight: 0.9 },
  { a: "hr_people", b: "engineering", weight: 0.85 },
  { a: "legal", b: "engineering", weight: 0.85 },
  { a: "legal", b: "sales", weight: 0.55 },
];

export const DEFAULT_PENALTIES = {
  genericOnlyOverlap: -2.15,
  salesVsAccountMismatch: -0.95,
  accountVsProductMismatch: -0.95,
  productVsSupportMismatch: -1.45,
  engineeringVsCustomerMismatch: -2.05,
  unrelatedFunctionDrift: -1.55,
  weakPhraseOnly: -0.85,
};

/**
 * Declarative role-head / family mismatch penalties (evaluated in order; all that match apply).
 * Extend per vendor via {@link VendorTitleHealthOptions.extraRoleHeadMismatchRules}.
 */
export const DEFAULT_ROLE_HEAD_MISMATCH_RULES: readonly RoleHeadMismatchRule[] = [
  {
    id: "penalty_sales_vs_account",
    penaltyKey: "salesVsAccountMismatch",
    queryFamiliesAny: ["account_management"],
    titleFamiliesAny: ["sales"],
    titleMustLackToken: "account",
    phraseFloorWhenMatched: 1.68,
  },
  {
    id: "penalty_account_vs_product",
    penaltyKey: "accountVsProductMismatch",
    queryFamiliesAny: ["account_management"],
    titleFamiliesAny: ["product"],
    titleMustLackToken: "account",
    phraseFloorWhenMatched: 1.12,
  },
  {
    id: "penalty_product_vs_support",
    penaltyKey: "productVsSupportMismatch",
    queryFamiliesAny: ["customer_support", "technical_support"],
    titleFamiliesAny: ["product"],
    titleMustLackToken: "support",
  },
  {
    id: "penalty_engineering_vs_customer_facing",
    penaltyKey: "engineeringVsCustomerMismatch",
    queryFamiliesAny: ["customer_support", "technical_support", "customer_success", "account_management"],
    titleFamiliesAny: ["engineering", "data_engineering", "platform_engineering", "devops_sre"],
  },
];
