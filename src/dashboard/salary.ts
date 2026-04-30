import { fetchUsdGbpToEurRates, type HardFilterFxRates } from "../pipeline/hardFilters";
import {
  hourlyStatedPayToMonthlyOriginal,
  isAnnualSalaryPeriod,
  isAnnualSalaryPeriodWithContext,
  isExplicitAnnualSalaryText,
  isExplicitHourlySalaryText,
  isImplausibleHourlyMid,
  preferMonthlyRangeFromBlobWhenStructuredLooksAnnual,
  salaryPeriodFromText,
} from "../pipeline/salaryPeriod";

export type DashboardSalarySource = {
  title: string | null;
  description: string | null;
  salary_raw: string | null;
  salary_min: number | null;
  salary_max: number | null;
  salary_currency: string | null;
};

const FX_CACHE_OK_MS = 6 * 60 * 60 * 1000;

let fxCache: { expiresAt: number; value: HardFilterFxRates } | null = null;

function salaryBlob(job: DashboardSalarySource): string {
  return `${job.title ?? ""}\n${job.salary_raw ?? ""}\n${job.description ?? ""}`;
}

/**
 * High-signal salary context — only the salary line + title. Used to detect the stated pay
 * period before falling back to full-description heuristics, so unrelated mentions like
 * "$100/month education budget" do not override an explicit "£70k-£85k per year".
 */
function salaryContextBlob(job: DashboardSalarySource): string {
  return `${job.title ?? ""}\n${job.salary_raw ?? ""}`;
}

function parseSalaryNumber(raw: string): number | null {
  const s = raw.trim().toLowerCase().replace(/\s+/g, "").replace(/,/g, "");
  if (!s) return null;
  const isK = s.endsWith("k");
  const base = isK ? s.slice(0, -1) : s;
  const n = Number(base);
  if (!Number.isFinite(n)) return null;
  return isK ? n * 1000 : n;
}

function fallbackSalaryBounds(job: DashboardSalarySource): { min: number | null; max: number | null } {
  const raw = job.salary_raw || "";
  const matches = Array.from(raw.matchAll(/(\d[\d\s,.]*\d|\d)(?:\s*[kK])?/g))
    .map((m) => parseSalaryNumber(m[0] || ""))
    .filter((n): n is number => typeof n === "number" && Number.isFinite(n) && n >= 100);
  if (matches.length === 0) return { min: null, max: null };
  return { min: matches[0] ?? null, max: matches[1] ?? null };
}

function normalizeSalaryCurrency(job: DashboardSalarySource): "EUR" | "USD" | "GBP" | null {
  const cur = (job.salary_currency || "").trim().toUpperCase();
  if (cur === "EUR" || cur === "€") return "EUR";
  if (cur === "USD" || cur === "US$") return "USD";
  if (cur === "GBP" || cur === "UKL") return "GBP";
  const sr = (job.salary_raw || "").toUpperCase();
  if (sr.includes("EUR") || /€/.test(job.salary_raw || "")) return "EUR";
  if (sr.includes("USD")) return "USD";
  if (sr.includes("GBP") || /£[\d\s,.]/.test(job.salary_raw || "")) return "GBP";
  if (/\$[\d\s,.]/.test(job.salary_raw || "") && !sr.includes("AUD") && !sr.includes("CAD") && !sr.includes("NZD")) {
    return "USD";
  }
  return null;
}

/** Net only when explicit; otherwise gross (brutto) for display conversion. */
function inferSalaryTaxKind(job: DashboardSalarySource): "net" | "gross" {
  const blob = salaryBlob(job).toLowerCase();
  if (/\bnet\b|\bafter\s+tax\b|\btake[-\s]*home\b/i.test(blob)) return "net";
  if (/\bgross\b|\bbrutto\b|\bbruto\b|\bbefore\s+tax\b|\bpre[-\s]*tax\b/i.test(blob)) return "gross";
  return "gross";
}

function toMonthlyEurFromOriginalCurrency(monthlyInCurrency: number, cur: "EUR" | "USD" | "GBP", fx: HardFilterFxRates): number | null {
  if (cur === "EUR") return monthlyInCurrency;
  if (cur === "USD") return monthlyInCurrency * fx.usdToEur;
  if (cur === "GBP") return monthlyInCurrency * fx.gbpToEur;
  return null;
}

function parseMonthlyEurSalary(job: DashboardSalarySource, fx: HardFilterFxRates): number | null {
  const fallback = fallbackSalaryBounds(job);
  let min = typeof job.salary_min === "number" ? job.salary_min : fallback.min;
  let max = typeof job.salary_max === "number" ? job.salary_max : fallback.max;
  if (min == null && max == null) return null;

  const cur = normalizeSalaryCurrency(job);
  if (!cur) return null;

  const blob = salaryBlob(job).toLowerCase();
  const contextBlob = salaryContextBlob(job).toLowerCase();
  const contextPeriod = salaryPeriodFromText(contextBlob);

  // Prose override is only safe when the salary line itself says monthly; otherwise we'd
  // honour a stray "3000 EUR/month stipend" in the description instead of the real range.
  if (contextPeriod === "monthly") {
    const proseMonthly = preferMonthlyRangeFromBlobWhenStructuredLooksAnnual(blob, min, max);
    if (proseMonthly) {
      min = proseMonthly.min;
      max = proseMonthly.max;
    }
  }

  const mid = min != null && max != null ? (min + max) / 2 : (min ?? max)!;

  // Hourly check prefers the salary line; only fall back to the full blob when the salary
  // line is silent, and never when the salary line explicitly says annual (e.g. "per annum"
  // next to boilerplate "hourly check-ins" elsewhere in the description). We also require
  // mid to be a plausible hourly wage — vendors sometimes annualize salary_min/max while
  // keeping "per hour" in salary_raw, which would otherwise yield millions of EUR/month.
  const hourlyFromContext = contextPeriod === "hourly";
  const hourlyFromBlob =
    contextPeriod == null && !isExplicitAnnualSalaryText(blob) && isExplicitHourlySalaryText(blob);
  const hourlySignal = hourlyFromContext || hourlyFromBlob;
  if (hourlySignal && !isImplausibleHourlyMid(mid)) {
    const monthlyInOriginalCurrency = hourlyStatedPayToMonthlyOriginal(mid, blob);
    return toMonthlyEurFromOriginalCurrency(monthlyInOriginalCurrency, cur, fx);
  }

  // When we ignored an implausible hourly label, drop the context entirely — otherwise
  // the "hourly" context would short-circuit `isAnnualSalaryPeriodWithContext` to monthly.
  const isAnnual = hourlySignal
    ? isAnnualSalaryPeriod(blob, mid, cur, fx)
    : isAnnualSalaryPeriodWithContext(contextBlob, blob, mid, cur, fx);
  const monthlyOriginal = isAnnual ? mid / 12 : mid;

  return toMonthlyEurFromOriginalCurrency(monthlyOriginal, cur, fx);
}

export function lvNet2026Default(gross: number): number {
  const EMPLOYEE_VSAOI = 0.105;
  const IIN = 0.255;
  const NON_TAXABLE = 550.0;

  const employeeSocial = gross * EMPLOYEE_VSAOI;
  const pitBase = gross - employeeSocial - NON_TAXABLE;
  const pit = Math.max(0, pitBase) * IIN;
  const net = gross - employeeSocial - pit;

  return Math.round(net * 100) / 100;
}

function formatRoundedEur(amount: number): string {
  return new Intl.NumberFormat("en-GB", { maximumFractionDigits: 0 }).format(Math.round(amount));
}

export async function getDashboardSalaryFxRates(): Promise<HardFilterFxRates> {
  const now = Date.now();
  if (fxCache && fxCache.expiresAt > now) return fxCache.value;

  const value = await fetchUsdGbpToEurRates();
  fxCache = {
    value,
    expiresAt: now + FX_CACHE_OK_MS,
  };
  return value;
}

export function formatDashboardSalaryEur(
  job: DashboardSalarySource,
  fx: HardFilterFxRates,
): string {
  const monthlyEur = parseMonthlyEurSalary(job, fx);
  if (typeof monthlyEur !== "number" || !Number.isFinite(monthlyEur) || monthlyEur <= 0) {
    return "N/A";
  }

  // Default to gross unless the listing explicitly marks the amount as net.
  const taxKind = inferSalaryTaxKind(job);
  const netMonthlyEur = taxKind === "net" ? monthlyEur : lvNet2026Default(monthlyEur);
  return `${formatRoundedEur(netMonthlyEur)} NET`;
}

/** Monthly EUR used for dashboard list sorting (same normalization as display; null when unknown). */
export function dashboardSalaryMonthlyEurForSort(
  job: DashboardSalarySource,
  fx: HardFilterFxRates,
): number | null {
  const monthlyEur = parseMonthlyEurSalary(job, fx);
  if (typeof monthlyEur !== "number" || !Number.isFinite(monthlyEur) || monthlyEur <= 0) return null;
  return monthlyEur;
}

/**
 * Dashboard list cache: combined compute of the NET-monthly-EUR number (sort key) and the rendered
 * display string. Persisted on `jobs.salary_monthly_eur` / `jobs.salary_display_eur` so that the
 * list endpoint never calls Frankfurter per request.
 */
export type SalaryEurCache = {
  monthlyEur: number | null;
  display: string;
};

export function computeSalaryEurCache(
  job: DashboardSalarySource,
  fx: HardFilterFxRates,
): SalaryEurCache {
  const monthlyEur = parseMonthlyEurSalary(job, fx);
  if (typeof monthlyEur !== "number" || !Number.isFinite(monthlyEur) || monthlyEur <= 0) {
    return { monthlyEur: null, display: "N/A" };
  }
  const taxKind = inferSalaryTaxKind(job);
  const netMonthlyEur = taxKind === "net" ? monthlyEur : lvNet2026Default(monthlyEur);
  return { monthlyEur: netMonthlyEur, display: `${formatRoundedEur(netMonthlyEur)} NET` };
}
