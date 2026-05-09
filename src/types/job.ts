import type { TitleQueryHealthBand } from "../metrics/titleQueryHealth/types";

export type JobSourceId = "jsearch" | "linkedin_jobs" | "jobs_api";

export type NormalizedJob = {
  source: JobSourceId;
  externalId: string;
  title: string;
  company: string;
  jobUrl: string;
  applyUrl: string;
  location: string;
  country?: string;
  isRemote: boolean;
  description: string;
  salaryRaw?: string;
  salaryMin?: number;
  salaryMax?: number;
  salaryCurrency?: string;
  employmentType?: string;
  /** Normalized workplace: on-site (Office), fully distributed (Remote), or mixed (Hybrid). */
  workplaceType?: "Office" | "Remote" | "Hybrid";
  /** OpenAI scoring read of workplace from description (canonical); used in {@link resolveWorkplaceType} after title. */
  workplaceTypeAi?: "Office" | "Remote" | "Hybrid";
  /** Unix seconds UTC: listing posted date from provider when available. */
  postedAtUnix?: number;
  /** Unix seconds UTC: when this payload was ingested from the provider API. */
  apiFetchedAtUnix?: number;
  /** Role/search string sent to the provider for this row (planned search query unit). */
  searchQuery?: string;
  /**
   * Optional canonical intended role for analytics (e.g. title↔query health).
   * When unset, {@link searchQuery} is used — it should already be the undecorated query unit.
   */
  canonicalSearchRole?: string;
  /** Deterministic 0..10 from title↔query health at ingest (vendor statistics). */
  titleQueryHealthScore?: number;
  titleQueryHealthBand?: TitleQueryHealthBand;
  /** Search planner tier for the query that produced this row; new ingests are always tier 1. */
  searchTier?: 1 | 2;
  /** Stable scheduler country key for analytics / future revision comparison. */
  searchCountryKey?: string;
  /** Human-readable country label used during the search that produced this row. */
  searchCountryLabel?: string;
  /**
   * HTTP request parameters actually used for the provider list/search (and optional detail) calls
   * that produced this row — dashboard “Pipeline & extraction” shows only this object.
   */
  ingestionRequestParams?: Record<string, string | number | boolean>;
  raw: Record<string, unknown>;
};

export type HardFilterResult = {
  pass: boolean;
  reasons: string[];
};

export type FitRecommendation =
  | "reject"
  | "low_priority_review"
  | "review"
  | "high_priority_review";

/** UI / email label for non-reject recommendations. */
export type FitPriorityLabel = "Low" | "Medium" | "High" | "";

export function fitPriorityLabel(r: FitRecommendation | string): FitPriorityLabel {
  const v = String(r).trim().toLowerCase().replace(/\s+/g, "_");
  if (v === "low_priority_review") return "Low";
  if (v === "review") return "Medium";
  if (v === "high_priority_review") return "High";
  return "";
}

function clampFitScore(n: unknown): number {
  const x = typeof n === "number" ? n : Number(n);
  if (Number.isNaN(x)) return 0;
  return Math.max(0, Math.min(100, Math.round(x)));
}

function toStringArrayMax(v: unknown, max: number): string[] {
  const a = Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  return a.slice(0, max);
}

/** Single-line AI rejection summary for dashboard (max ~220 chars). */
export function normalizeRejectionReason(s: unknown): string {
  if (typeof s !== "string") return "";
  return s.replace(/\s+/g, " ").trim().slice(0, 220);
}

function normalizeFitRecommendation(s: unknown, score: number): FitRecommendation {
  if (typeof s === "string") {
    const v = s.trim().toLowerCase().replace(/\s+/g, "_");
    if (
      v === "reject" ||
      v === "low_priority_review" ||
      v === "review" ||
      v === "high_priority_review"
    ) {
      return v as FitRecommendation;
    }
  }
  if (score >= 85) return "high_priority_review";
  if (score >= 75) return "review";
  if (score >= 60) return "low_priority_review";
  return "reject";
}

/** Parse scoring_json or API payload; maps legacy reasons_to_apply / risks to positives / negatives. */
function optBool(v: unknown): boolean | undefined {
  if (typeof v === "boolean") return v;
  return undefined;
}

function optNum(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  return undefined;
}

function optStr(v: unknown): string | undefined {
  if (typeof v === "string") {
    const s = v.trim();
    return s.length ? s : undefined;
  }
  return undefined;
}

/** Three-sentence job summary from scoring JSON; clamp length for storage/UI. */
function normalizePositionSummary(v: unknown): string {
  if (typeof v !== "string") return "";
  return v.replace(/\s+/g, " ").trim().slice(0, 2500);
}

function optPeriod(v: unknown): "hourly" | "monthly" | "annual" | "unknown" | undefined {
  if (typeof v !== "string") return undefined;
  const x = v.trim().toLowerCase();
  if (x === "hourly" || x === "monthly" || x === "annual" || x === "unknown") return x;
  return undefined;
}

function optTaxHint(v: unknown): "net" | "gross" | "unknown" | undefined {
  if (typeof v !== "string") return undefined;
  const x = v.trim().toLowerCase();
  if (x === "net" || x === "gross" || x === "unknown") return x;
  return undefined;
}

function optWorkplaceTypeAi(v: unknown): "Office" | "Remote" | "Hybrid" | undefined {
  if (typeof v !== "string") return undefined;
  const x = v.trim().toLowerCase();
  if (x === "unknown" || x === "") return undefined;
  if (x === "office" || x === "on_site" || x === "onsite") return "Office";
  if (x === "remote" || x === "wfh") return "Remote";
  if (x === "hybrid") return "Hybrid";
  return undefined;
}

export function parseScoringFromJson(raw: unknown): ScoringResult | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const fit_score = clampFitScore(o.fit_score);
  const recommendation = normalizeFitRecommendation(o.recommendation, fit_score);
  const positives = toStringArrayMax(o.positives ?? o.reasons_to_apply, 3);
  const negatives = toStringArrayMax(o.negatives ?? o.risks, 3);
  const rejection_reason = normalizeRejectionReason(o.rejection_reason);
  const position_summary = normalizePositionSummary(o.position_summary);
  return {
    fit_score,
    recommendation,
    position_summary,
    positives,
    negatives,
    rejection_reason,
    priority_label: fitPriorityLabel(recommendation),
    salary_found: optBool(o.salary_found),
    salary_lower: optNum(o.salary_lower),
    salary_upper: optNum(o.salary_upper),
    salary_currency: optStr(o.salary_currency),
    salary_period: optPeriod(o.salary_period),
    salary_tax_hint: optTaxHint(o.salary_tax_hint),
    salary_line: optStr(o.salary_line),
    workplace_type_ai:
      optWorkplaceTypeAi(o.workplace_type_ai) ?? optWorkplaceTypeAi(o.workplace_type),
  };
}

export type ScoringResult = {
  fit_score: number;
  recommendation: FitRecommendation;
  /** Neutral 3-sentence job essence / responsibilities (from scoring model). */
  position_summary: string;
  positives: string[];
  negatives: string[];
  /** One-line explanation when recommendation is reject; shown in Filtered tab. */
  rejection_reason: string;
  priority_label: FitPriorityLabel;
  /** AI extraction from description (optional). */
  salary_found?: boolean;
  /** Lower end of stated range, in listing currency units. */
  salary_lower?: number;
  salary_upper?: number;
  salary_currency?: string;
  salary_period?: "hourly" | "monthly" | "annual" | "unknown";
  salary_tax_hint?: "net" | "gross" | "unknown";
  /** One-line summary for salary_raw when not using min/max formatting. */
  salary_line?: string;
  /** Model classification from title + description (canonical Office | Remote | Hybrid). */
  workplace_type_ai?: "Office" | "Remote" | "Hybrid";
};


export type JobRecordStatus =
  | "imported"
  | "failed"
  | "hard_rejected"
  | "rejected_by_ai"
  | "pending_materials"
  | "dashboard_open"
  | "review_email_sent"
  | "approved"
  | "rejected"
  | "edit_pending";
