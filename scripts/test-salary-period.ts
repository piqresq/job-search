import assert from "node:assert/strict";
import {
  computeSalaryEurCache,
  dashboardSalaryMonthlyEurForSort,
  type DashboardSalarySource,
} from "../src/dashboard/salary";
import type { HardFilterFxRates } from "../src/pipeline/hardFilters";
import {
  isAnnualSalaryPeriod,
  isAnnualSalaryPeriodWithContext,
  isExplicitAnnualSalaryText,
  isExplicitMonthlySalaryText,
  salaryPeriodFromText,
} from "../src/pipeline/salaryPeriod";

const FX: HardFilterFxRates = { usdToEur: 0.92, gbpToEur: 1.17 };

let failures = 0;
function run(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`  pass  ${name}`);
  } catch (err) {
    failures += 1;
    console.error(`  FAIL  ${name}`);
    console.error(err);
  }
}

console.log("isExplicitMonthlySalaryText — no false positives on boilerplate 'month'");
{
  const cases = [
    "4-week sprint cycles",
    "12-15 active implementations at a time, each lasting 4-8 weeks",
    "$100/month education budget",
    "50/month stipend",
    "three-month probation",
    "1 month notice period",
    "monthly newsletter",
    "12 months of tenure",
  ];
  for (const text of cases) {
    run(`"${text}" is not monthly`, () => {
      assert.equal(isExplicitMonthlySalaryText(text.toLowerCase()), false);
    });
  }
}

console.log("isExplicitMonthlySalaryText — still catches real monthly salary phrasings");
{
  const cases = [
    "EUR 3000 per month",
    "€3,500 / month",
    "3000-5000 EUR/month",
    "3k/month base",
    "monthly salary 4500 EUR",
    "monthly gross 3200 EUR",
    "net/month 4000 EUR",
    "5000 / mo",
    "£3500/mo",
    "per calendar month 3500 GBP",
  ];
  for (const text of cases) {
    run(`"${text}" is monthly`, () => {
      assert.equal(isExplicitMonthlySalaryText(text.toLowerCase()), true);
    });
  }
}

console.log("isExplicitAnnualSalaryText — unchanged, still catches 'per year'");
{
  run(`"£70k-£85k per year" is annual`, () => {
    assert.equal(isExplicitAnnualSalaryText("£70k-£85k per year".toLowerCase()), true);
  });
  run(`"$120,000 per annum" is annual`, () => {
    assert.equal(isExplicitAnnualSalaryText("$120,000 per annum".toLowerCase()), true);
  });
}

console.log("salaryPeriodFromText — prefers salary-line context");
{
  run("salary_raw '£70k-£85k per year' → annual", () => {
    assert.equal(salaryPeriodFromText("£70k-£85k per year".toLowerCase()), "annual");
  });
  run("salary_raw '3000-5000 EUR/month' → monthly", () => {
    assert.equal(salaryPeriodFromText("3000-5000 eur/month"), "monthly");
  });
  run("empty context → null", () => {
    assert.equal(salaryPeriodFromText(""), null);
  });
  run("ambiguous context (annual + monthly) → null", () => {
    assert.equal(
      salaryPeriodFromText("£70k-£85k per year or 3000 eur per month".toLowerCase()),
      null,
    );
  });
}

console.log("isAnnualSalaryPeriodWithContext — context wins over noisy blob");
{
  const ctx = "high touch implementation specialist\n£70k-£85k per year";
  const blob = `${ctx}\n$100/month education budget\nunlimited pto with four weeks recommended per year`;
  run("annual salary_raw + '/month stipend' in body → annual", () => {
    assert.equal(
      isAnnualSalaryPeriodWithContext(ctx.toLowerCase(), blob.toLowerCase(), 77500, "GBP", FX),
      true,
    );
  });

  const ctxMonthly = "3000-5000 eur/month";
  const blobMonthly = `${ctxMonthly}\nannual performance review`;
  run("monthly salary_raw + 'annual performance review' → monthly", () => {
    assert.equal(
      isAnnualSalaryPeriodWithContext(ctxMonthly, blobMonthly, 4000, "EUR", FX),
      false,
    );
  });
}

console.log("isAnnualSalaryPeriod — ambiguous blob falls back to EUR threshold");
{
  const blob = "3000 eur per month\n$120,000 per year"; // both tokens present
  run("ambiguous blob with 77500 GBP mid → annual (threshold)", () => {
    assert.equal(isAnnualSalaryPeriod(blob, 77500, "GBP", FX), true);
  });
  run("ambiguous blob with 4500 EUR mid → monthly (threshold)", () => {
    assert.equal(isAnnualSalaryPeriod(blob, 4500, "EUR", FX), false);
  });
}

console.log("computeSalaryEurCache — regression: Ashby GBP annual with /month in body");
{
  const job: DashboardSalarySource = {
    title: "High Touch Implementation Specialist - EMEA",
    description:
      "As a founding member of the High Touch Implementation team, you will manage 12-15 active implementations at a time, each lasting 4-8 weeks.\n" +
      "Unlimited PTO with four weeks recommended per year.\n" +
      "$100/month education budget with more expensive items covered with manager approval.",
    salary_raw: "£70k-£85k per year",
    salary_min: 70000,
    salary_max: 85000,
    salary_currency: "GBP",
  };
  const cache = computeSalaryEurCache(job, FX);
  run("mid 77500 GBP → divided by 12 → 7.5k gross EUR → ~5k NET", () => {
    assert.ok(cache.monthlyEur != null, "monthlyEur should be computed");
    // Expected gross monthly: 77500 * 1.17 / 12 = ~7556.25 EUR
    // After lvNet2026Default: ~5180 EUR NET (well under 8000).
    assert.ok(
      cache.monthlyEur! >= 3500 && cache.monthlyEur! <= 6500,
      `monthlyEur out of expected NET band: ${cache.monthlyEur}`,
    );
    // Before the fix this returned ~60k EUR because mid was treated as already-monthly.
    assert.ok(
      cache.monthlyEur! < 10000,
      `monthlyEur suspiciously high — period misdetection: ${cache.monthlyEur}`,
    );
  });
  run("display uses NET suffix", () => {
    assert.ok(/NET$/.test(cache.display), `unexpected display: ${cache.display}`);
  });
}

console.log("computeSalaryEurCache — explicit monthly in salary_raw still treated monthly");
{
  const job: DashboardSalarySource = {
    title: "Software Engineer",
    description: "The annual performance review is in Q4.",
    salary_raw: "3000-5000 EUR/month gross",
    salary_min: 3000,
    salary_max: 5000,
    salary_currency: "EUR",
  };
  const monthly = dashboardSalaryMonthlyEurForSort(job, FX);
  run("monthly sort value preserved (~4000 EUR)", () => {
    assert.ok(monthly != null, "monthly should be set");
    assert.ok(
      monthly! >= 3500 && monthly! <= 4500,
      `expected ~4000 EUR/month, got ${monthly}`,
    );
  });
}

console.log("computeSalaryEurCache — hourly label with annualized structured numbers");
{
  // Real vendor payload: text says "$50-$60 per hour" but salary_min/max are already
  // annualized. Before the guard we'd multiply 66000 * 167 * FX = millions of EUR/month.
  const job: DashboardSalarySource = {
    title: "Quality Control Specialist 50$H-60$H",
    description: "Remote QC role.",
    salary_raw: "$50–$60 per hour gross",
    salary_min: 60000,
    salary_max: 72000,
    salary_currency: "USD",
  };
  const monthly = dashboardSalaryMonthlyEurForSort(job, FX);
  run("huge mid with 'per hour' label → treated as annual, not hourly", () => {
    assert.ok(monthly != null, "monthly should be set");
    // 66000 USD/year × 0.92 / 12 ≈ 5060 gross EUR/month.
    assert.ok(
      monthly! >= 3000 && monthly! <= 8000,
      `expected annualized band, got ${monthly}`,
    );
  });
}

console.log("computeSalaryEurCache — plausible hourly wage still treated hourly");
{
  const job: DashboardSalarySource = {
    title: "Remote QA Tester",
    description: "Flexible weekly hours.",
    salary_raw: "$45 per hour gross",
    salary_min: 40,
    salary_max: 50,
    salary_currency: "USD",
  };
  const monthly = dashboardSalaryMonthlyEurForSort(job, FX);
  run("mid=45 USD/h → ~45 × 167 × 0.92 = ~6915 EUR/month gross", () => {
    assert.ok(monthly != null, "monthly should be set");
    assert.ok(
      monthly! >= 5000 && monthly! <= 9000,
      `expected hourly-derived band, got ${monthly}`,
    );
  });
}

console.log("computeSalaryEurCache — very large GBP with no period text still divides by 12");
{
  const job: DashboardSalarySource = {
    title: "Director of Engineering",
    description: "Lead a distributed team.",
    salary_raw: "£120,000 - £140,000",
    salary_min: 120000,
    salary_max: 140000,
    salary_currency: "GBP",
  };
  // `dashboardSalaryMonthlyEurForSort` returns GROSS monthly EUR (matches list-sort contract);
  // we just need to confirm the threshold branch treated the number as annual (÷12) rather than
  // as monthly. 130000 GBP/year × 1.17 / 12 ≈ 12,675 EUR gross/month.
  const monthly = dashboardSalaryMonthlyEurForSort(job, FX);
  run("130k GBP with no period → EUR threshold treats as annual", () => {
    assert.ok(monthly != null, "monthly should be set");
    assert.ok(
      monthly! >= 10000 && monthly! <= 15000,
      `expected ~12.7k gross monthly EUR, got ${monthly}`,
    );
  });

  const cache = computeSalaryEurCache(job, FX);
  run("display NET for same job is below gross (LV formula applied)", () => {
    assert.ok(cache.monthlyEur != null, "cache.monthlyEur should be set");
    assert.ok(
      cache.monthlyEur! < monthly!,
      `NET (${cache.monthlyEur}) should be less than gross (${monthly})`,
    );
    assert.ok(
      cache.monthlyEur! >= 6000 && cache.monthlyEur! <= 11000,
      `expected NET band ~8.5k, got ${cache.monthlyEur}`,
    );
  });
}

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed.`);
  process.exit(1);
}
console.log("\nAll salary period tests passed.");
