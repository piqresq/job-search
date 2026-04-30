import { franc } from "franc-min";
import type { HardFilterResult, NormalizedJob } from "../types/job";
import {
  hourlyStatedPayToMonthlyOriginal,
  isAnnualSalaryPeriod,
  isAnnualSalaryPeriodWithContext,
  isExplicitAnnualSalaryText,
  isExplicitHourlySalaryText,
  isImplausibleHourlyMid,
  preferMonthlyRangeFromBlobWhenStructuredLooksAnnual,
  salaryPeriodFromText,
} from "./salaryPeriod";

/** Full-time salary floors (EUR/month). Part-time listings skip salary filtering. */
export const NET_MONTHLY_MIN_EUR = 3000;
export const GROSS_MONTHLY_MIN_EUR = 4288.93;

const DEGREE_HARD_PATTERNS: RegExp[] = [
  /\bmaster'?s\s+degree\s+required\b/i,
  /\bbachelor'?s\s+degree\s+required\b/i,
  /\buniversity\s+degree\s+required\b/i,
  /\bcollege\s+degree\s+required\b/i,
  /\bdegree\s+required\b/i,
  /\bmaster'?s\s+or\s+bachelor/i,
  /\bMBA\s+required\b/i,
];

const US_AUTH_PATTERNS: RegExp[] = [
  /\bUS\s+citizen(?:ship)?\s+required\b/i,
  /\bauthorized\s+to\s+work\s+in\s+the\s+united\s+states\b/i,
  /\blegal\s+authorization\s+to\s+work\s+in\s+the\s+US\b/i,
  /\bmust\s+be\s+eligible\s+to\s+work\s+in\s+the\s+US\b/i,
];

const US_RESIDENCY_PATTERNS: RegExp[] = [
  /\bmust\s+(?:reside|live)\s+in\s+the\s+united\s+states\b/i,
  /\bUS\s+residents?\s+only\b/i,
  /\blocated\s+in\s+the\s+US\s+only\b/i,
];

const COMMUTE_RADIUS_PATTERNS: RegExp[] = [
  /\b\d+\s*(?:mi|miles|km)\s+(?:of|from)\b/i,
  /\bwithin\s+\d+\s*(?:mi|miles|km)\b/i,
  /\b(?:on-?site|onsite)\s+\d+\s*days?\b/i,
];

const LOCAL_PRESENCE_PATTERNS: RegExp[] = [
  /\bmust\s+be\s+based\s+in\s+[A-Z][a-z]+\b(?!.*remote)/i,
  /\brequired\s+to\s+work\s+from\s+(?:our\s+)?[A-Z][a-z]+\s+office\b/i,
];

const HYBRID_ONSITE_EXPLICIT: RegExp[] = [
  /\bhybrid\s+role\b/i,
  /\bhybrid\s+work\b/i,
  /\bon-?site\s+required\b/i,
  /\bon-?site\s+only\b/i,
  /\b100%\s+on-?site\b/i,
  /\boffice\s+presence\s+required\b/i,
];

/**
 * Languages allowed as mandatory requirements: English, Russian, Latvian only.
 * These names are excluded from the disallowed list (handled by omission).
 */
const MANDATORY_LANG_REQ_TOKEN = String.raw`(?:\b(?:required|mandatory)\b|\bmust\s+speak\b|\bfluent\s+in\b|\bproficiency\s+in\b|\bnative\s+speaker\b|\bworking\s+knowledge\s+of\b|\b(?:C1|C2|B2)\b(?:\s+level|\s+or\s+above)?|\blanguage\s+requirements?\b|\bSprachkenntnisse\b)`;

/** Mandatory requirement for a language other than English, Russian, or Latvian. */
const DISALLOWED_MANDATORY_LANGUAGES =
  String.raw`German|French|Spanish|Italian|Portuguese|Dutch|Polish|Swedish|Norwegian|Danish|Finnish|Czech|Romanian|Hungarian|Greek|Turkish|Arabic|Chinese|Mandarin|Cantonese|Japanese|Korean|Hindi|Urdu|Ukrainian|Bulgarian|Slovak|Slovenian|Croatian|Serbian|Bosnian|Estonian|Lithuanian|Hebrew|Indonesian|Vietnamese|Thai|Persian|Farsi|Malay|Tagalog|Welsh|Irish|Icelandic|Albanian|Macedonian|Georgian|Armenian|Kazakh|Uzbek|Bengali|Tamil|Swahili|Catalan|Somali|Zulu|Afrikaans`;

const MANDATORY_OTHER_LANGUAGE_RE = new RegExp(
  `(?:${MANDATORY_LANG_REQ_TOKEN})[\\s\\S]{0,140}?\\b(?:${DISALLOWED_MANDATORY_LANGUAGES})\\b|\\b(?:${DISALLOWED_MANDATORY_LANGUAGES})\\b[\\s\\S]{0,140}?(?:${MANDATORY_LANG_REQ_TOKEN})`,
  "i",
);

/** Frankfurter ECB rates: EUR per 1 unit of base (USD/GBP). */
export type HardFilterFxRates = {
  usdToEur: number;
  gbpToEur: number;
};

const FRANKFURTER_USD = "https://api.frankfurter.app/latest?from=USD&to=EUR";
const FRANKFURTER_GBP = "https://api.frankfurter.app/latest?from=GBP&to=EUR";
const FX_MAX_ATTEMPTS = 6;
const FX_BACKOFF_MS = 400;

/** Used when Frankfurter is unavailable (EUR per 1 USD / 1 GBP). */
export const FALLBACK_USD_TO_EUR = 0.84;
export const FALLBACK_GBP_TO_EUR = 1.13;

export function failSafeUsdGbpToEurRates(): HardFilterFxRates {
  return { usdToEur: FALLBACK_USD_TO_EUR, gbpToEur: FALLBACK_GBP_TO_EUR };
}

/** Single attempt; prefer `fetchUsdGbpToEurRates` (retries). */
async function fetchUsdGbpToEurRatesOnce(): Promise<HardFilterFxRates | null> {
  try {
    const [u, g] = await Promise.all([fetch(FRANKFURTER_USD), fetch(FRANKFURTER_GBP)]);
    if (!u.ok || !g.ok) return null;
    const ju = (await u.json()) as { rates?: { EUR?: number } };
    const jg = (await g.json()) as { rates?: { EUR?: number } };
    const usd = ju.rates?.EUR;
    const gbp = jg.rates?.EUR;
    if (typeof usd !== "number" || typeof gbp !== "number") return null;
    return { usdToEur: usd, gbpToEur: gbp };
  } catch {
    return null;
  }
}

/**
 * USD→EUR and GBP→EUR from Frankfurter (ECB). Retries with backoff; if all attempts fail,
 * returns {@link failSafeUsdGbpToEurRates} so salary checks never skip conversion.
 */
export async function fetchUsdGbpToEurRates(): Promise<HardFilterFxRates> {
  for (let i = 0; i < FX_MAX_ATTEMPTS; i++) {
    const fx = await fetchUsdGbpToEurRatesOnce();
    if (fx) return fx;
    if (i < FX_MAX_ATTEMPTS - 1) {
      await new Promise((r) => setTimeout(r, FX_BACKOFF_MS * (i + 1)));
    }
  }
  console.warn(
    "[hardFilters] Frankfurter unavailable after retries; using fail-safe USD→EUR",
    FALLBACK_USD_TO_EUR,
    "GBP→EUR",
    FALLBACK_GBP_TO_EUR,
  );
  return failSafeUsdGbpToEurRates();
}

/** franc-min uses up to ~2k chars internally; keep sample aligned. */
const LANGUAGE_SAMPLE_MAX = 2048;

function countLatinAndCyrillicLetters(text: string): { latin: number; cyrillic: number } {
  let latin = 0;
  let cyrillic = 0;
  for (const ch of text) {
    if (/[A-Za-z]/.test(ch)) latin++;
    else if (/[\u0400-\u04FF]/.test(ch)) cyrillic++;
  }
  return { latin, cyrillic };
}

function displayLanguageName(iso6393: string): string {
  const map: Record<string, string> = {
    deu: "German",
    fra: "French",
    spa: "Spanish",
    ita: "Italian",
    por: "Portuguese",
    nld: "Dutch",
    pol: "Polish",
    swe: "Swedish",
    lav: "Latvian",
    lit: "Lithuanian",
    est: "Estonian",
    ces: "Czech",
    ron: "Romanian",
    hun: "Hungarian",
    ell: "Greek",
    ukr: "Ukrainian",
    bel: "Belarusian",
    bul: "Bulgarian",
    srp: "Serbian",
    hrv: "Croatian",
    slk: "Slovak",
    slv: "Slovenian",
    fin: "Finnish",
    dan: "Danish",
    nob: "Norwegian",
    nno: "Norwegian",
    tur: "Turkish",
    ara: "Arabic",
    zho: "Chinese",
    jpn: "Japanese",
    kor: "Korean",
    hin: "Hindi",
    vie: "Vietnamese",
    uzb: "Uzbek",
    kaz: "Kazakh",
  };
  return map[iso6393] ?? iso6393;
}

/**
 * Hard filter: listing text must be primarily English or Russian (ISO 639-3 `eng` / `rus`).
 * Uses franc-min on title + description + location; replaces regex “required language” matching.
 */
function languageDetectionHardFilterReason(text: string): string | null {
  const sample = text.trim().slice(0, LANGUAGE_SAMPLE_MAX);
  if (sample.length < 10) {
    return null;
  }

  const code = franc(sample);
  if (code === "eng" || code === "rus") {
    return null;
  }

  const { latin, cyrillic } = countLatinAndCyrillicLetters(sample);
  const letterSum = latin + cyrillic;
  if (letterSum === 0) {
    return null;
  }

  const cyrRatio = cyrillic / letterSum;
  const latRatio = latin / letterSum;

  if (code === "und" && cyrRatio >= 0.45) {
    return null;
  }

  if (code === "und" && latRatio >= 0.88) {
    return null;
  }

  if (code === "und") {
    return "Could not determine language as English or Russian (mixed or ambiguous text)";
  }

  return `Listing text appears to be primarily ${displayLanguageName(code)} (${code}), not English or Russian`;
}

function textBlob(job: NormalizedJob): string {
  return `${job.title}\n${job.description}\n${job.location}`;
}

function matchesAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some((re) => re.test(text));
}

export function normalizeJobSalaryCurrency(job: NormalizedJob): "EUR" | "USD" | "GBP" | null {
  const cur = (job.salaryCurrency || "").trim().toUpperCase();
  if (cur === "EUR" || cur === "€") return "EUR";
  if (cur === "USD" || cur === "US$") return "USD";
  if (cur === "GBP" || cur === "UKL") return "GBP";
  const sr = (job.salaryRaw || "").toUpperCase();
  if (sr.includes("EUR") || /€/.test(job.salaryRaw || "")) return "EUR";
  if (sr.includes("USD")) return "USD";
  if (sr.includes("GBP") || /£[\d\s,.]/.test(job.salaryRaw || "")) return "GBP";
  if (/\$[\d\s,.]/.test(job.salaryRaw || "") && !sr.includes("AUD") && !sr.includes("CAD") && !sr.includes("NZD"))
    return "USD";
  return null;
}

/** True when the listing is part-time — salary floor rules do not apply. */
export function isPartTimeJob(job: NormalizedJob): boolean {
  const et = (job.employmentType || "").trim();
  const u = et.toUpperCase().replace(/[\s-]/g, "");
  if (u === "FULLTIME" || u === "FULL_TIME") return false;
  if (/\bFULL[\s_-]?TIME\b/i.test(et)) return false;
  if (et === "Parttime") return true;
  if (u.includes("PART") || /\bPARTTIME\b/i.test(et) || /\bPART[\s_-]?TIME\b/i.test(et)) return true;
  const blob = `${job.title}\n${job.description}`.slice(0, 12000);
  if (/\bpart[-\s]?time\b/i.test(blob)) return true;
  return false;
}

function parseMonthlyEurFromJob(
  job: NormalizedJob,
  fx: HardFilterFxRates,
): { monthlyEur?: number; isNet?: boolean; sourceLabel?: string } {
  let min = job.salaryMin;
  let max = job.salaryMax;
  if (typeof min !== "number" && typeof max !== "number") return {};

  const cur = normalizeJobSalaryCurrency(job);
  if (!cur) return {};

  const blob = `${job.title || ""}\n${job.salaryRaw || ""}\n${job.description}`.toLowerCase();
  const contextBlob = `${job.title || ""}\n${job.salaryRaw || ""}`.toLowerCase();
  const contextPeriod = salaryPeriodFromText(contextBlob);

  if (contextPeriod === "monthly") {
    const proseMonthly = preferMonthlyRangeFromBlobWhenStructuredLooksAnnual(
      blob,
      typeof min === "number" ? min : null,
      typeof max === "number" ? max : null,
    );
    if (proseMonthly) {
      min = proseMonthly.min;
      max = proseMonthly.max;
    }
  }

  const mid =
    typeof min === "number" && typeof max === "number"
      ? (min + max) / 2
      : typeof min === "number"
        ? min
        : (max as number);

  /** Net only if the listing says so; otherwise treat as gross (brutto) for floor comparison. */
  const isNet = /\bnet\b|\bafter\s+tax\b|\btake\s*home\b/i.test(blob);

  let monthlyOriginal: number;
  const hourlyFromContext = contextPeriod === "hourly";
  const hourlyFromBlob =
    contextPeriod == null && !isExplicitAnnualSalaryText(blob) && isExplicitHourlySalaryText(blob);
  const hourlySignal = hourlyFromContext || hourlyFromBlob;
  // Ignore the hourly label when mid is implausibly large (vendor annualized salary_min/max
  // but left "per hour" in salary_raw) and fall back to annual/monthly detection. When we do
  // ignore it, drop the context too — otherwise the "hourly" context would short-circuit
  // `isAnnualSalaryPeriodWithContext` to monthly and leave mid in its annualized form.
  if (hourlySignal && !isImplausibleHourlyMid(mid)) {
    monthlyOriginal = hourlyStatedPayToMonthlyOriginal(mid, blob);
  } else {
    const isAnnual = hourlySignal
      ? isAnnualSalaryPeriod(blob, mid, cur, fx)
      : isAnnualSalaryPeriodWithContext(contextBlob, blob, mid, cur, fx);
    monthlyOriginal = isAnnual ? mid / 12 : mid;
  }

  let monthlyEur: number;
  let sourceLabel: string | undefined;

  if (cur === "EUR") {
    monthlyEur = monthlyOriginal;
    sourceLabel = "EUR";
  } else if (cur === "USD") {
    monthlyEur = monthlyOriginal * fx.usdToEur;
    sourceLabel = `USD→EUR (×${fx.usdToEur.toFixed(4)})`;
  } else if (cur === "GBP") {
    monthlyEur = monthlyOriginal * fx.gbpToEur;
    sourceLabel = `GBP→EUR (×${fx.gbpToEur.toFixed(4)})`;
  } else {
    return {};
  }

  return { monthlyEur, isNet, sourceLabel };
}

/**
 * Jobs API GET detail (`mergeJobsApiPat92` stores `raw.detail`) — when `acceptingApplications` is explicitly
 * `false`, the listing is closed for applications (Pat92 / RapidAPI field name).
 */
function jobsApiDetailNotAcceptingApplications(job: NormalizedJob): boolean {
  if (job.source !== "jobs_api") return false;
  const raw = job.raw;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
  const detail = (raw as { detail?: unknown }).detail;
  if (!detail || typeof detail !== "object" || Array.isArray(detail)) return false;
  return (detail as Record<string, unknown>).acceptingApplications === false;
}

/**
 * Salary-below-floor reasons (same thresholds as hard filters). Empty when no numeric salary or part-time.
 */
export function getSalaryBelowFloorReasons(
  job: NormalizedJob,
  fx: HardFilterFxRates,
): string[] {
  if (isPartTimeJob(job)) return [];

  const { monthlyEur, isNet, sourceLabel } = parseMonthlyEurFromJob(job, fx);
  if (typeof monthlyEur !== "number" || monthlyEur <= 0) return [];

  const reasons: string[] = [];
  const suffix = sourceLabel ? ` (${sourceLabel})` : "";
  if (isNet && monthlyEur < NET_MONTHLY_MIN_EUR) {
    reasons.push(`Salary below ${NET_MONTHLY_MIN_EUR} EUR net/month${suffix}`);
  }
  if (!isNet && monthlyEur < GROSS_MONTHLY_MIN_EUR) {
    reasons.push(`Salary below ${GROSS_MONTHLY_MIN_EUR} EUR gross/month${suffix}`);
  }
  return reasons;
}

/**
 * @param fx - USD/GBP→EUR (live or fail-safe). Defaults to {@link failSafeUsdGbpToEurRates} for tests.
 */
export function applyHardFilters(
  job: NormalizedJob,
  fx: HardFilterFxRates = failSafeUsdGbpToEurRates(),
): HardFilterResult {
  const reasons: string[] = [];
  const text = textBlob(job);

  if (matchesAny(text, DEGREE_HARD_PATTERNS)) {
    reasons.push("Explicit degree requirement detected");
  }

  if (matchesAny(text, HYBRID_ONSITE_EXPLICIT)) {
    reasons.push("Explicit hybrid or on-site requirement");
  }

  if (matchesAny(text, US_AUTH_PATTERNS)) {
    reasons.push("Explicit US work authorization requirement");
  }

  if (matchesAny(text, US_RESIDENCY_PATTERNS)) {
    reasons.push("Explicit US residency requirement");
  }

  if (matchesAny(text, COMMUTE_RADIUS_PATTERNS)) {
    reasons.push("Explicit local commuting radius requirement");
  }

  if (matchesAny(text, LOCAL_PRESENCE_PATTERNS)) {
    reasons.push("Explicit local country/office presence requirement");
  }

  if (MANDATORY_OTHER_LANGUAGE_RE.test(text)) {
    reasons.push(
      "Mandatory language requirement for a language other than English, Russian, or Latvian detected",
    );
  }

  const langReason = languageDetectionHardFilterReason(text);
  if (langReason) {
    reasons.push(langReason);
  }

  if (jobsApiDetailNotAcceptingApplications(job)) {
    reasons.push("Jobs API: listing is not accepting applications (detail.acceptingApplications is false)");
  }

  if (!isPartTimeJob(job)) {
    reasons.push(...getSalaryBelowFloorReasons(job, fx));
  }

  return { pass: reasons.length === 0, reasons };
}
