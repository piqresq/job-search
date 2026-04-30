/**
 * Unit tests for Pat92 Jobs API merge + date helpers (no network).
 * Run: npm run test:jobs-api-merge
 */
import assert from "node:assert/strict";
import { applyHardFilters } from "../src/pipeline/hardFilters";
import { datePostedYmdToUnix, mergeJobsApiPat92 } from "../src/providers/jobsApi";
import { finalizeNormalizedJob } from "../src/providers/lib/normalizedJobValidation";

const jan15NoonUtc = Math.floor(Date.UTC(2024, 0, 15, 12, 0, 0) / 1000);

assert.equal(datePostedYmdToUnix("2024-01-15"), jan15NoonUtc);
assert.equal(datePostedYmdToUnix(undefined), undefined);
assert.equal(datePostedYmdToUnix("not-a-date"), undefined);

const merged = mergeJobsApiPat92(
  {
    id: "job-1",
    title: "Search title",
    companyName: "SearchCo",
    linkedinUrl: "https://www.linkedin.com/jobs/view/1",
    location: "United Kingdom",
    datePosted: "2024-01-15",
  },
  {
    title: "Detail title",
    companyName: "DetailCo",
    linkedinUrl: "https://www.linkedin.com/jobs/view/detail",
    description: "Full JD for scoring and filters.",
    employmentType: "FULL_TIME",
  } as Record<string, unknown>,
);

assert.equal(merged?.externalId, "job-1");
assert.equal(merged?.title, "Detail title");
assert.equal(merged?.company, "DetailCo");
assert.equal(merged?.jobUrl, "https://www.linkedin.com/jobs/view/detail");
assert.equal(merged?.applyUrl, merged?.jobUrl);
assert.equal(merged?.location, "United Kingdom");
assert.equal(merged?.description, "Full JD for scoring and filters.");
assert.equal(merged?.employmentType, "Fulltime");
assert.equal(merged?.postedAtUnix, jan15NoonUtc);
assert.equal(merged?.isRemote, true);
assert.equal(merged?.source, "jobs_api");
assert.ok(merged?.raw && typeof merged.raw === "object");

const searchOnly = mergeJobsApiPat92(
  {
    id: "job-2",
    title: "Only search",
    companyName: "Co",
    linkedinUrl: "https://li/x",
    location: "Remote",
    datePosted: "2024-02-01",
  },
  null,
);
assert.equal(searchOnly?.externalId, "job-2");
assert.equal(searchOnly?.title, "Only search");
assert.equal(searchOnly?.description, "");
assert.equal(searchOnly?.postedAtUnix, Math.floor(Date.UTC(2024, 1, 1, 12, 0, 0) / 1000));
assert.equal(finalizeNormalizedJob(searchOnly, { country: "United Kingdom", isRemote: true }), null);

const finalized = finalizeNormalizedJob(merged, { country: "United Kingdom", isRemote: true });
assert.equal(finalized?.country, "United Kingdom");
assert.equal(finalized?.isRemote, true);

const notAccepting = mergeJobsApiPat92(
  {
    id: "job-closed",
    title: "Support",
    companyName: "Co",
    linkedinUrl: "https://www.linkedin.com/jobs/view/closed",
    location: "United Kingdom",
    datePosted: "2024-01-20",
  },
  {
    title: "Support",
    companyName: "Co",
    linkedinUrl: "https://www.linkedin.com/jobs/view/closed",
    description: "Remote customer support role. Work in English.",
    employmentType: "FULL_TIME",
    acceptingApplications: false,
  } as Record<string, unknown>,
);
assert.ok(notAccepting);
const hfClosed = applyHardFilters(notAccepting);
assert.equal(hfClosed.pass, false);
assert.ok(hfClosed.reasons.some((r) => r.includes("accepting applications")));

const accepting = mergeJobsApiPat92(
  {
    id: "job-open",
    title: "Support",
    companyName: "Co",
    linkedinUrl: "https://www.linkedin.com/jobs/view/open",
    location: "United Kingdom",
    datePosted: "2024-01-21",
  },
  {
    title: "Support",
    companyName: "Co",
    linkedinUrl: "https://www.linkedin.com/jobs/view/open",
    description: "Remote customer support role. Work in English.",
    employmentType: "FULL_TIME",
    acceptingApplications: true,
  } as Record<string, unknown>,
);
assert.ok(accepting);
const hfOpen = applyHardFilters(accepting);
assert.equal(hfOpen.pass, true);

console.log("test-jobs-api-merge: ok");
