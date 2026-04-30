import assert from "node:assert/strict";
import {
  isPersistentVendorQuotaStatus,
  isTransientVendorLimitStatus,
} from "../src/providers/lib/rapidApiJson";

// Regression for jobs_api (Pat92/jobs-api14) 2026-04-22 monthly-quota incident.
// RapidAPI returns HTTP 429 with "exceeded the MONTHLY quota" body when the plan's
// billing-period budget is gone. The previous classifier only treated this as
// persistent for 402/403, so the pipeline entered a 300s-retry loop all day and
// fired ~79 moderate-severity incidents before the next UTC midnight reset.
const jobsApi429Monthly =
  '{"message":"You have exceeded the MONTHLY quota for Requests on your current plan, PRO. Upgrade your plan at https://rapidapi.com/Pat92/api/jobs-api14"}';
assert.equal(isPersistentVendorQuotaStatus(429, jobsApi429Monthly), true);
assert.equal(isTransientVendorLimitStatus(429, jobsApi429Monthly), false);

// 403 + monthly quota language still counts as persistent (pre-existing behaviour).
const vendor403Plan = '{"message":"Quota exceeded: please upgrade your plan"}';
assert.equal(isPersistentVendorQuotaStatus(403, vendor403Plan), true);
assert.equal(isTransientVendorLimitStatus(403, vendor403Plan), false);

// 402 is always persistent (Payment Required).
assert.equal(isPersistentVendorQuotaStatus(402, ""), true);

// Plain per-minute 429 throttling ("too many requests", no billing-period language)
// is still transient so the planned-search retries the next cycle, not the next UTC day.
const jsearch429PerMinute = '{"message":"Too many requests. Please try again later."}';
assert.equal(isPersistentVendorQuotaStatus(429, jsearch429PerMinute), false);
assert.equal(isTransientVendorLimitStatus(429, jsearch429PerMinute), true);

// 403 without quota wording → neither class (falls through to generic vendor error).
const generic403 = '{"message":"Forbidden"}';
assert.equal(isPersistentVendorQuotaStatus(403, generic403), false);
assert.equal(isTransientVendorLimitStatus(403, generic403), false);

// 500 upstream → generic vendor error (caller records it without planned-search backoff).
const upstream500 = '{"message":"An unknown error has occurred"}';
assert.equal(isPersistentVendorQuotaStatus(500, upstream500), false);
assert.equal(isTransientVendorLimitStatus(500, upstream500), false);

console.log("test-rapidapi-quota-classification: ok");
