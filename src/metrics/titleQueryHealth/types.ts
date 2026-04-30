export type TitleQueryHealthBand =
  | "exact"
  | "strong"
  | "good"
  | "moderate"
  | "weak"
  | "poor"
  | "unrelated";

export type TitleQueryHealthComponentScores = {
  phraseMatch: number;
  weightedCoverage: number;
  familySimilarity: number;
  expansionTolerance: number;
  penalties: number;
};

export type VendorTitleHealthPenaltyOverrides = {
  genericOnlyOverlap?: number;
  salesVsAccountMismatch?: number;
  accountVsProductMismatch?: number;
  productVsSupportMismatch?: number;
  engineeringVsCustomerMismatch?: number;
  unrelatedFunctionDrift?: number;
  weakPhraseOnly?: number;
};

export type TitleHealthPenaltyKey = keyof VendorTitleHealthPenaltyOverrides;

export type FamilyAdjacencyOverrideRow = { a: string; b: string; strength: number };
export type FamilyConflictOverrideRow = { a: string; b: string; weight: number };

export type RoleHeadMismatchRule = {
  id: string;
  penaltyKey: TitleHealthPenaltyKey;
  queryFamiliesAny: readonly string[];
  titleFamiliesAny: readonly string[];
  titleMustLackToken?: string;
  /**
   * When this rule fires, floor phraseMatch (0..2) so lexical overlap is not double-punished
   * after the declarative mismatch penalty (config-driven, not example-specific code paths).
   */
  phraseFloorWhenMatched?: number;
};

export type VendorTitleHealthOptions = {
  vendorId?: string;
  canonicalQueryExtractor?: (rawQuery: string) => string;
  extraNoiseTokens?: string[];
  tokenWeightOverrides?: Record<string, number>;
  synonymOverrides?: Record<string, string[]>;
  adjacencyOverrides?: Record<string, string[]>;
  penaltyOverrides?: VendorTitleHealthPenaltyOverrides;
  /** Appended to default family adjacency rows (symmetric strength 0..1). */
  familyAdjacencyOverrides?: readonly FamilyAdjacencyOverrideRow[] | null;
  /** Appended to default family conflict rows. */
  familyConflictOverrides?: readonly FamilyConflictOverrideRow[] | null;
  /** Appended after defaults; use stable `id` strings (shown in reasons / debug). */
  extraRoleHeadMismatchRules?: readonly RoleHeadMismatchRule[] | null;
  /**
   * Applied to the family similarity sub-score (0..2) after defaults. Use 0 to ignore families for a vendor,
   * or values above 1 to weight them more; clamped to [0, 2].
   */
  familySimilarityMultiplier?: number;
};

export type RoleFamilyHit = {
  id: string;
  confidence: number;
};

/** Parsed role / title structure used by the scorer (deterministic). */
export type ParsedRoleText = {
  normalized: string;
  tokens: string[];
  coreTokens: string[];
  genericTokens: string[];
  ignoredTokens: string[];
  roleFamilies: RoleFamilyHit[];
  industryHints: string[];
  seniorityHints: string[];
  modifiers: string[];
};

export type TitleQueryHealthParseSnapshot = {
  normalized: string;
  tokens: string[];
  coreTokens: string[];
  genericTokens: string[];
  ignoredTokens: string[];
  modifiers: string[];
  industryHints: string[];
  seniorityHints: string[];
  roleFamilies: { id: string; confidence: number }[];
};

export type TitleQueryHealthResult = {
  score: number;
  band: TitleQueryHealthBand;
  reasons: string[];
  debug: {
    normalizedQuery: string;
    normalizedTitle: string;
    queryParse: TitleQueryHealthParseSnapshot | null;
    titleParse: TitleQueryHealthParseSnapshot | null;
    /** False when query has no core tokens or no core token hit title literal/synonym (adjacency gated off). */
    adjacencyAllowed?: boolean;
    /** How positive linear sum is mapped to 0..10 before penalties (auditable). */
    scoreScaleNote?: string;
    queryCoreTokens: string[];
    titleCoreTokens: string[];
    queryGenericTokens: string[];
    titleGenericTokens: string[];
    matchedTokens: string[];
    synonymMatchedTokens: string[];
    roleFamiliesQuery: string[];
    roleFamiliesTitle: string[];
    penalties: string[];
    componentScores: TitleQueryHealthComponentScores;
  };
};
