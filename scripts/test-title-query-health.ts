/**
 * Calibration + adversarial tests for title↔query health (deterministic scorer).
 * Run: npx tsx scripts/test-title-query-health.ts
 */
import { scoreTitleToQueryHealth } from "../src/metrics/titleQueryHealth/scorer";

function assertRange(name: string, score: number, min: number, max: number): void {
  if (score < min || score > max) {
    console.error(`FAIL ${name}: score ${score} not in [${min}, ${max}]`);
    process.exit(1);
  }
  console.log(`OK ${name}: ${score}`);
}

function assertMax(name: string, score: number, max: number): void {
  if (score > max) {
    console.error(`FAIL ${name}: score ${score} > ${max} (must stay low)`);
    process.exit(1);
  }
  console.log(`OK ${name} (<= ${max}): ${score}`);
}

function main(): void {
  assertRange("Customer Support vs self", scoreTitleToQueryHealth("Customer Support", "Customer Support").score, 9.5, 10);

  assertRange(
    "Customer Support vs Manager",
    scoreTitleToQueryHealth("Customer Support", "Customer Support Manager").score,
    8.5,
    10,
  );

  assertRange(
    "Customer Support vs Manager geo",
    scoreTitleToQueryHealth(
      "Customer Support",
      "Customer Support Manager - Eastern Europe, Full Time",
    ).score,
    8,
    10,
  );

  assertRange(
    "Integration Consultant vs Workflow Integration Senior Consultant",
    scoreTitleToQueryHealth("Integration Consultant", "Workflow Integration Senior Consultant").score,
    8,
    10,
  );

  assertRange(
    "Product Operations Manager vs Product Operations & Customer Experience Manager",
    scoreTitleToQueryHealth(
      "Product Operations Manager",
      "Product Operations & Customer Experience Manager",
    ).score,
    6.5,
    9,
  );

  assertRange(
    "Integration Consultant vs OIC Cloud Technical Consultant",
    scoreTitleToQueryHealth("Integration Consultant", "OIC Cloud Technical Consultant").score,
    4,
    8,
  );

  assertRange(
    "Key Account Manager vs Junior Sales Manager",
    scoreTitleToQueryHealth("Key Account Manager", "Junior Sales Manager").score,
    1.5,
    6.5,
  );

  assertRange(
    "Account Manager vs Staff Product Manager, Onboarding",
    scoreTitleToQueryHealth("Account Manager", "Staff Product Manager, Onboarding").score,
    1,
    5,
  );

  assertRange(
    "Key Account Manager vs Regional Sales Manager, Germany - Aerospace & Defense",
    scoreTitleToQueryHealth(
      "Key Account Manager",
      "Regional Sales Manager, Germany - Aerospace & Defense",
    ).score,
    1,
    5,
  );

  assertRange(
    "Unrelated",
    scoreTitleToQueryHealth("Customer Support", "Software Engineer, Backend").score,
    0,
    2.5,
  );

  assertRange(
    "Data Engineer vs Senior Data Platform Engineer",
    scoreTitleToQueryHealth("Data Engineer", "Senior Data Platform Engineer").score,
    7.5,
    10,
  );

  assertRange(
    "HR Manager vs People Operations Lead",
    scoreTitleToQueryHealth("HR Manager", "People Operations Lead").score,
    4.5,
    8,
  );

  assertRange(
    "DevOps Engineer vs Site Reliability Engineer",
    scoreTitleToQueryHealth("DevOps Engineer", "Site Reliability Engineer").score,
    5,
    9,
  );

  assertRange(
    "Finance Analyst vs FP&A Analyst",
    scoreTitleToQueryHealth("Finance Analyst", "FP&A Analyst").score,
    5,
    9,
  );

  assertRange(
    "Recruiter vs Enterprise Account Executive",
    scoreTitleToQueryHealth("Recruiter", "Enterprise Account Executive").score,
    0,
    3.5,
  );

  assertRange(
    "Legal Counsel vs Commercial Contracts Lawyer",
    scoreTitleToQueryHealth("Legal Counsel", "Commercial Contracts Lawyer").score,
    4,
    9,
  );

  assertRange("Nurse vs Software Engineer", scoreTitleToQueryHealth("Nurse", "Software Engineer").score, 0, 2);

  assertRange(
    "People Operations Lead vs HR Manager (order swap)",
    scoreTitleToQueryHealth("People Operations Lead", "HR Manager").score,
    4,
    8,
  );

  assertMax("Account Manager vs Product Manager (generic head only)", scoreTitleToQueryHealth("Account Manager", "Product Manager").score, 3.5);

  assertMax("Customer Support vs Technical Consultant", scoreTitleToQueryHealth("Customer Support", "Technical Consultant").score, 3.5);

  assertMax("HR Manager vs Sales Manager", scoreTitleToQueryHealth("HR Manager", "Sales Manager").score, 3.5);

  assertMax("Finance Analyst vs Business Analyst", scoreTitleToQueryHealth("Finance Analyst", "Business Analyst").score, 4);

  assertMax("Manager vs Manager (single generic token)", scoreTitleToQueryHealth("Manager", "Manager").score, 4);

  assertMax("Specialist vs Specialist", scoreTitleToQueryHealth("Specialist", "Specialist").score, 4);

  assertRange(
    "Obvious strong: Senior Software Engineer vs Software Engineer II",
    scoreTitleToQueryHealth("Software Engineer", "Senior Software Engineer II").score,
    6,
    10,
  );

  console.log("\nAll title-query health checks passed.");
}

main();
