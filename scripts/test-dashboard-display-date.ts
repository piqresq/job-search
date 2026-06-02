/**
 * Unit tests for posted-first dashboard display date (no network).
 * Run: npm run test:dashboard-display-date
 */
import assert from "node:assert/strict";
import {
  dashboardDisplayDateSortKey,
  resolveDashboardDisplayDateUnix,
  type DashboardListRow,
} from "../src/db/jobs";

const posted = 1_700_000_000;
const fetched = 1_800_000_000;

assert.equal(resolveDashboardDisplayDateUnix(posted, fetched), posted);
assert.equal(resolveDashboardDisplayDateUnix(0, fetched), fetched);
assert.equal(resolveDashboardDisplayDateUnix(0, 0), 0);

const rowBoth: DashboardListRow = {
  id: "abc",
  source: "jobs_api",
  title: "Engineer",
  company: "Co",
  job_url: null,
  apply_url: null,
  salary_raw: null,
  salary_min: null,
  salary_max: null,
  salary_currency: null,
  salary_monthly_eur: null,
  salary_display_eur: null,
  fit_score: 80,
  recommendation: "review",
  reasons_to_apply: null,
  risks: null,
  r2_cv_key: null,
  r2_cover_key: null,
  status: "active",
  hard_reject_reasons: null,
  scoring_notes: null,
  content_dedupe_hash: null,
  country_name: "UK",
  employment_type: "Fulltime",
  workplace_type: "Remote",
  search_query: "engineer",
  search_tier: 1,
  position_summary: null,
  normalized_json: null,
  created_at: fetched,
  posted_at_unix: posted,
  api_fetched_at_unix: fetched,
};

assert.equal(dashboardDisplayDateSortKey(rowBoth), posted);

const rowFetchOnly: DashboardListRow = { ...rowBoth, posted_at_unix: null };
assert.equal(dashboardDisplayDateSortKey(rowFetchOnly), fetched);

const rowCreatedOnly: DashboardListRow = {
  ...rowBoth,
  posted_at_unix: null,
  api_fetched_at_unix: null,
  created_at: fetched,
};
assert.equal(dashboardDisplayDateSortKey(rowCreatedOnly), fetched);

console.log("test-dashboard-display-date: ok");
