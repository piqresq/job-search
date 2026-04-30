import type { NormalizedJob, ScoringResult } from "../types/job";

/** Structured min/max from the job board API — do not overwrite with AI extraction. */
export function jobHasProviderSalaryNumbers(job: NormalizedJob): boolean {
  return typeof job.salaryMin === "number" || typeof job.salaryMax === "number";
}

const ALLOWED_AI_SALARY_CURRENCIES = new Set(["EUR", "USD", "GBP"]);

/**
 * Fills salary_* from AI when the provider did not supply numeric salary and the model found a range in the description.
 * Uses the lower end of a range for min; max is the upper end when given, else same as min.
 * Numbers must match salary_period (hourly / monthly / annual) so salary normalization can convert to monthly EUR.
 * Currency must be EUR/USD/GBP for Frankfurter conversion. Tax: unknown → gross (brutto) for pipeline + dashboard.
 */
export function mergeSalaryFromScoring(job: NormalizedJob, scoring: ScoringResult): NormalizedJob {
  if (!scoring.salary_found || typeof scoring.salary_lower !== "number" || !Number.isFinite(scoring.salary_lower)) {
    return job;
  }
  if (jobHasProviderSalaryNumbers(job)) return job;

  const cur = (scoring.salary_currency || "").trim().toUpperCase();
  if (!ALLOWED_AI_SALARY_CURRENCIES.has(cur)) {
    return job;
  }

  const lower = scoring.salary_lower;
  const upper =
    typeof scoring.salary_upper === "number" && Number.isFinite(scoring.salary_upper)
      ? scoring.salary_upper
      : lower;

  /** Net only when explicit; gross and unknown → gross (same as hard filter + dashboard). */
  let taxNote = " gross";
  if (scoring.salary_tax_hint === "net") taxNote = " net";
  else if (scoring.salary_tax_hint === "gross") taxNote = " gross";

  const period = scoring.salary_period ?? "unknown";
  let periodNote = "";
  if (period === "annual") periodNote = " per year";
  else if (period === "monthly") periodNote = " per month";
  else if (period === "hourly") periodNote = " per hour";

  const rawLine =
    scoring.salary_line?.trim() ||
    `${lower}${upper !== lower ? `–${upper}` : ""} ${cur}${periodNote}${taxNote}`.trim();

  return {
    ...job,
    salaryMin: lower,
    salaryMax: upper,
    salaryCurrency: cur,
    salaryRaw: rawLine,
  };
}

/** Copies AI workplace classification from scoring into `NormalizedJob.workplaceTypeAi` when set. */
export function mergeWorkplaceTypeFromScoring(job: NormalizedJob, scoring: ScoringResult): NormalizedJob {
  const w = scoring.workplace_type_ai;
  if (w !== "Office" && w !== "Remote" && w !== "Hybrid") return job;
  return { ...job, workplaceTypeAi: w };
}
