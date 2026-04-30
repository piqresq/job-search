/** Same shape as HardFilterFxRates (Frankfurter USD/GBP → EUR). */
export type SalaryFxRates = { usdToEur: number; gbpToEur: number };

/** EUR threshold: amounts above this (in EUR equivalent of the stated figure) are treated as yearly unless text says monthly. */
export const ANNUAL_AMOUNT_THRESHOLD_EUR = 10000;

/**
 * Explicit yearly compensation in listing text (English + common variants).
 */
export function isExplicitAnnualSalaryText(blob: string): boolean {
  const b = blob.toLowerCase();
  return (
    /\bper\s+year\b|\bper\s+annum\b|\bannual(?:ly)?\s+(?:salary|compensation|pay|wage)\b|\b(?:year|yearly)\s+salary\b|\b salary\s*\/\s*year\b|\b\/yr\b|\b p\.?\s*a\.?\b|\bpa\b(?=\s|$|[,.])/i.test(
      b,
    ) ||
    /\b(?:brutto|gross|net)?\s*[€$£]?\s*[\d\s,.]+(?:k|000)?\s*(?:per\s+)?(?:year|annum|a\/year)\b/i.test(b) ||
    /\b\d[\d\s,.]*(?:k|000)?\s*(?:eur|€|usd|gbp|£|\$)?\s*\/\s*(?:year|yr|annum)\b/i.test(b) ||
    /\b(?:euro|eur|usd|gbp)\s*[\d\s,.]+\s*(?:per\s+)?(?:year|annum)\b/i.test(b)
  );
}

/**
 * Collapses "3,500" / "3 500" / "3.500" thousand-separator forms so regexes that count
 * consecutive digits (e.g. `\d{4,}`) see the full amount. We only collapse when the
 * suffix is a run of exactly 3 digits followed by a word-boundary so ordinary decimals
 * like "3.5" or "4.75" stay intact.
 */
function collapseThousandsSeparators(blob: string): string {
  let s = blob;
  s = s.replace(/(\d)[,\u202f\u00a0 ](\d{3})(?=\D|$)/g, "$1$2");
  s = s.replace(/(\d)\.(\d{3})(?=\D|$)/g, "$1$2");
  return s;
}

/**
 * Explicit monthly compensation — overrides the >10k EUR annual heuristic.
 * Important: ranges like "3000-5000 Eur/month" must match here; otherwise a large
 * mistaken min/max can hit {@link isLikelyAnnualByEurThreshold} and be divided by 12 wrongly.
 *
 * Regex deliberately avoids bare `month` (matches "1-month probation", "monthly updates"),
 * bare `/month` without a salary-sized amount ("$100/month stipend"), and loose "pm"
 * abbreviations (ambiguous with PM time), so a stray description mention does not flip
 * an unambiguous yearly `salary_raw` ("£70k-£85k per year") into monthly.
 */
export function isExplicitMonthlySalaryText(blob: string): boolean {
  const b = collapseThousandsSeparators(blob.toLowerCase());
  return (
    /\bper\s+(?:calendar\s+)?month\b/i.test(b) ||
    /\bmonthly\s+(?:salary|compensation|pay|wage|rate|base|gross|net|brutto|bruto)\b/i.test(b) ||
    /\b(?:salary|compensation|pay|wage|rate|base|gross|net|brutto|bruto)\s*\/\s*mo(?:nth)?\b/i.test(b) ||
    /\b(?:eur|€|euro|usd|gbp|£|\$)\s*\/\s*mo(?:nth)?\b/i.test(b) ||
    /\b\d[\d\s,.]*(?:k|000)\s*(?:eur|€|euro|usd|gbp|£|\$)?\s*\/\s*(?:month|mo)\b/i.test(b) ||
    /\b\d{4,}\s*(?:eur|€|euro|usd|gbp|£|\$)?\s*\/\s*(?:month|mo)\b/i.test(b) ||
    /\b\d[\d\s,.]*(?:k|000)?\s*[-–]\s*\d[\d\s,.]*(?:k|000)?\s*(?:eur|€|euro|usd|gbp|£|\$)?\s*\/\s*(?:month|mo)\b/i.test(b)
  );
}

/**
 * If the stated amount is over ANNUAL_AMOUNT_THRESHOLD_EUR when expressed in EUR (same scale as the posting),
 * treat as yearly and divide by 12. Uses FX for USD/GBP when provided.
 */
export function isLikelyAnnualByEurThreshold(
  mid: number,
  currency: "EUR" | "USD" | "GBP",
  fx: SalaryFxRates | null,
): boolean {
  if (currency === "EUR") return mid > ANNUAL_AMOUNT_THRESHOLD_EUR;
  if (currency === "USD") {
    if (fx) return mid * fx.usdToEur > ANNUAL_AMOUNT_THRESHOLD_EUR;
    return mid > ANNUAL_AMOUNT_THRESHOLD_EUR;
  }
  if (currency === "GBP") {
    if (fx) return mid * fx.gbpToEur > ANNUAL_AMOUNT_THRESHOLD_EUR;
    return mid > ANNUAL_AMOUNT_THRESHOLD_EUR;
  }
  return false;
}

/**
 * Whether the stated min/max midpoint is an annual figure (divide by 12 for monthly EUR).
 *
 * When annual and monthly tokens both appear in the blob (common when description copy
 * mentions unrelated monthly stipends or weekly PTO etc.), neither can be trusted blindly
 * — fall back to the EUR threshold so a true 70k/year range isn't treated as 70k/month.
 */
export function isAnnualSalaryPeriod(
  blob: string,
  mid: number,
  currency: "EUR" | "USD" | "GBP",
  fx: SalaryFxRates | null,
): boolean {
  const monthlyText = isExplicitMonthlySalaryText(blob);
  const annualText = isExplicitAnnualSalaryText(blob);
  if (annualText && !monthlyText) return true;
  if (monthlyText && !annualText) return false;
  return isLikelyAnnualByEurThreshold(mid, currency, fx);
}

/** Period signal from a small, high-signal blob (e.g. title + salary_raw). */
export type SalaryPeriodSignal = "annual" | "monthly" | "hourly" | null;

/**
 * Detects the stated pay period from a focused text — callers pass title + salary_raw so
 * that description noise ("$100/month education budget", "4-week sprint cycles") does not
 * override an explicit "£70k per year" in the provider's salary line.
 */
export function salaryPeriodFromText(text: string): SalaryPeriodSignal {
  if (!text) return null;
  const annual = isExplicitAnnualSalaryText(text);
  const monthly = isExplicitMonthlySalaryText(text);
  const hourly = isExplicitHourlySalaryText(text);
  if (annual && !monthly && !hourly) return "annual";
  if (monthly && !annual && !hourly) return "monthly";
  if (hourly && !annual && !monthly) return "hourly";
  return null;
}

/**
 * Annual/monthly decision that prefers the salary-line context (`contextBlob`) over the
 * full blob. Only falls back to the wider blob + EUR threshold when the salary line itself
 * is silent about the period.
 */
export function isAnnualSalaryPeriodWithContext(
  contextBlob: string,
  fallbackBlob: string,
  mid: number,
  currency: "EUR" | "USD" | "GBP",
  fx: SalaryFxRates | null,
): boolean {
  const ctx = salaryPeriodFromText(contextBlob);
  if (ctx === "annual") return true;
  if (ctx === "monthly" || ctx === "hourly") return false;
  return isAnnualSalaryPeriod(fallbackBlob, mid, currency, fx);
}

/** Parses bands like "3000-5000 eur/month" (ASCII blob, lowercased). */
function extractMonthlyEurRangeFromBlob(blob: string): { min: number; max: number } | null {
  const re =
    /\b(\d{3,5})\s*[-–]\s*(\d{3,5})\s*(?:eur|€|euro)\s*\/\s*mo(?:nth)?\b/i;
  const m = blob.match(re);
  if (!m) return null;
  const a = parseInt(m[1]!, 10);
  const c = parseInt(m[2]!, 10);
  if (!Number.isFinite(a) || !Number.isFinite(c)) return null;
  const lo = Math.min(a, c);
  const hi = Math.max(a, c);
  if (lo < 400 || hi > 100_000) return null;
  if (hi > lo * 25) return null;
  return { min: lo, max: hi };
}

/**
 * When copy states a clear EUR monthly range (e.g. "3000-5000 Eur/month") but structured
 * min/max look like a yearly total (often above 10k EUR then ÷12), prefer the prose figures.
 */
export function preferMonthlyRangeFromBlobWhenStructuredLooksAnnual(
  blob: string,
  structuredMin: number | null,
  structuredMax: number | null,
): { min: number; max: number } | null {
  if (!isExplicitMonthlySalaryText(blob)) return null;
  const extracted = extractMonthlyEurRangeFromBlob(blob);
  if (!extracted) return null;

  const structMid =
    typeof structuredMin === "number" && typeof structuredMax === "number"
      ? (structuredMin + structuredMax) / 2
      : typeof structuredMin === "number"
        ? structuredMin
        : typeof structuredMax === "number"
          ? structuredMax
          : null;
  if (structMid == null || !Number.isFinite(structMid)) return null;

  const descMid = (extracted.min + extracted.max) / 2;
  if (descMid <= 0) return null;

  const structuredLooksYearlyVersusCopy = structMid > Math.max(15_000, descMid * 6);
  if (!structuredLooksYearlyVersusCopy) return null;

  return extracted;
}

/** Default hourly × implied full-time month when weekly hours are not stated (matches scoring prompt). */
export const HOURLY_WAGE_TO_MONTHLY_EQUIVALENT = 167;

/**
 * Above this mid-value (in the listing's stated currency) the "hourly" label almost
 * certainly doesn't apply to the structured salary_min/max: vendors routinely mirror
 * the posting's text ("$50-$60/hr") into salary_raw while populating salary_min / salary_max
 * with an already-annualized conversion (e.g. 60,000–72,000 USD). Multiplying 60,000 by
 * 167 hrs/month would produce millions of EUR "per month" — a nonsense output.
 *
 * 500 is generously above top-end consultant bill rates in USD/EUR/GBP while staying well
 * below any realistic annualized number.
 */
export const IMPLAUSIBLE_HOURLY_MID_THRESHOLD = 500;

/** True when `mid` is far too large to plausibly be an hourly wage in the posting's currency. */
export function isImplausibleHourlyMid(mid: number): boolean {
  return Number.isFinite(mid) && mid > IMPLAUSIBLE_HOURLY_MID_THRESHOLD;
}

/**
 * Listing text clearly describes an hourly wage (amounts are per hour until converted).
 * Kept in sync with dashboard salary parsing so hard filters and UI agree.
 */
export function isExplicitHourlySalaryText(blob: string): boolean {
  const b = blob.toLowerCase();
  if (/\bper\s+hour\b|\bhourly\b|\bhour\s+rate\b|\bhr\s*rate\b|\bper\s+h\b/.test(b)) return true;
  if (/\b[\d\s,.]+\s*(?:€|eur|gbp|usd|\$|£)\s*\/\s*h\b/.test(b)) return true;
  if (/(?:€|eur|gbp|usd|\$|£)\s*[\d\s,.]+\s*\/\s*h\b/.test(b)) return true;
  if (/\b\/\s*hr\b|\b\/hr\b|\bp\/h\b/.test(b)) return true;
  if (/[\d,.]\s*\/\s*h\b/.test(b)) return true;
  return false;
}

/** Weekly hours when the posting states them (e.g. 37.5 h/week); null if unknown. */
export function parseWeeklyHoursFromBlob(blob: string): number | null {
  const b = blob.toLowerCase();
  const patterns: RegExp[] = [
    /\b(\d{1,2}(?:\.\d)?)\s*(?:hours?|hrs|h)\s*(?:\/|\s+per\s+|\s+a\s+)\s*week\b/i,
    /\b(\d{1,2}(?:\.\d)?)\s*h\/w\b/i,
    /\b(\d{1,2}(?:\.\d)?)\s*(?:hours?|hrs)\s+pw\b/i,
    /\b(\d{1,2}(?:\.\d)?)\s*\/\s*w\b(?!\s*[a-z])/i,
  ];
  for (const re of patterns) {
    const m = b.match(re);
    if (m?.[1]) {
      const n = Number(m[1]);
      if (Number.isFinite(n) && n >= 1 && n <= 80) return n;
    }
  }
  return null;
}

/** Converts stated hourly pay (same currency as `hourlyMid`) to monthly in that currency. */
export function hourlyStatedPayToMonthlyOriginal(hourlyMid: number, blob: string): number {
  const weekly = parseWeeklyHoursFromBlob(blob);
  if (weekly != null) {
    return hourlyMid * weekly * (52 / 12);
  }
  return hourlyMid * HOURLY_WAGE_TO_MONTHLY_EQUIVALENT;
}
