/**
 * Unit tests for content dedupe fingerprints (no network).
 * Run: npm run test:content-dedupe-hash
 */
import assert from "node:assert/strict";
import {
  buildContentDedupeFingerprint,
  computeContentDedupeHash,
  computeCountryInclusiveContentDedupeHash,
  isContentDedupeAnchorJob,
} from "../src/pipeline/contentDedupeHash";
import type { NormalizedJob } from "../src/types/job";

function job(overrides: Partial<NormalizedJob> = {}): NormalizedJob {
  return {
    source: "linkedin_jobs",
    externalId: "1",
    title: "Senior Customer Success Manager",
    company: "Acme",
    jobUrl: "https://example.com/job",
    applyUrl: "https://example.com/apply",
    location: "Remote",
    country: "United Kingdom",
    isRemote: true,
    workplaceType: "Remote",
    description: "Remote customer success role.",
    employmentType: "Fulltime",
    salaryRaw: "5000 EUR/month",
    raw: {},
    ...overrides,
  };
}

const remoteUk = job({ country: "United Kingdom", searchCountryLabel: "United Kingdom" });
const remoteGermany = job({ country: "Germany", searchCountryLabel: "Germany" });
const legacyRemoteFrance = job({
  country: "France",
  searchCountryLabel: "France",
  workplaceType: undefined,
});

assert.equal(
  buildContentDedupeFingerprint(remoteUk),
  buildContentDedupeFingerprint(remoteGermany),
  "remote fingerprints should ignore country",
);
assert.equal(
  await computeContentDedupeHash(remoteUk),
  await computeContentDedupeHash(remoteGermany),
  "remote hashes should ignore country",
);
assert.notEqual(
  buildContentDedupeFingerprint(legacyRemoteFrance),
  buildContentDedupeFingerprint(remoteUk),
  "legacy stored rows without workplaceType still show why the pipeline recomputes candidates after assignment",
);
assert.notEqual(
  await computeCountryInclusiveContentDedupeHash(remoteUk),
  await computeContentDedupeHash(remoteUk),
  "legacy remote hash still includes country for fallback lookups",
);

const scoredRemoteUk = job({
  salaryMin: 4000,
  salaryMax: 5000,
  salaryCurrency: "EUR",
  salaryRaw: "4000-5000 EUR per month gross",
  workplaceTypeAi: "Remote",
});
assert.notEqual(
  await computeContentDedupeHash(scoredRemoteUk),
  await computeContentDedupeHash(remoteUk),
  "AI-enriched salary can change a recomputed current hash, so fallback must use stored legacy hash",
);
assert.notEqual(
  await computeCountryInclusiveContentDedupeHash(scoredRemoteUk),
  await computeCountryInclusiveContentDedupeHash(remoteUk),
  "AI-enriched salary can also change a recomputed legacy hash, so fallback must not hash stored scored JSON",
);

const hybridUk = job({
  country: "United Kingdom",
  searchCountryLabel: "United Kingdom",
  isRemote: false,
  workplaceType: "Hybrid",
});
const hybridGermany = job({
  country: "Germany",
  searchCountryLabel: "Germany",
  isRemote: false,
  workplaceType: "Hybrid",
});

assert.notEqual(
  buildContentDedupeFingerprint(hybridUk),
  buildContentDedupeFingerprint(hybridGermany),
  "non-remote fingerprints should keep country",
);
assert.notEqual(
  await computeContentDedupeHash(hybridUk),
  await computeContentDedupeHash(hybridGermany),
  "non-remote hashes should keep country",
);

assert.equal(
  isContentDedupeAnchorJob({
    dash_bucket: "active",
    status: "dashboard_open",
    hard_reject_reasons: null,
    recommendation: "review",
  }),
  true,
  "active list rows with a final recommendation anchor dedupe",
);

assert.equal(
  isContentDedupeAnchorJob({
    dash_bucket: "filtered",
    status: "hard_rejected",
    hard_reject_reasons: JSON.stringify(["Mandatory language requirement detected"]),
    recommendation: null,
  }),
  true,
  "filtered hard rejects without duplicate listing anchor dedupe",
);

assert.equal(
  isContentDedupeAnchorJob({
    dash_bucket: "filtered",
    status: "hard_rejected",
    hard_reject_reasons: JSON.stringify([
      "Duplicate listing (content-hash dedupe; fingerprint 77df6ae0… matches an earlier saved job)",
    ]),
    recommendation: null,
  }),
  false,
  "duplicate-listing filtered rows must not anchor dedupe",
);

const gtmLeeds = job({
  title: "Go-to-Market Engineer - Leeds, United Kingdom",
  company: "Speechify",
  country: "United Kingdom",
  workplaceType: "Hybrid",
  isRemote: false,
});
const gtmCambridge = job({
  title: "Go-to-Market Engineer - Cambridge, United Kingdom",
  company: "Speechify",
  country: "United Kingdom",
  workplaceType: "Hybrid",
  isRemote: false,
});
const gtmPlain = job({
  title: "Go-to-Market Engineer",
  company: "Speechify",
  country: "United Kingdom",
  workplaceType: "Hybrid",
  isRemote: false,
});
const gtmEmDash = job({
  title: "Go-to-Market Engineer — Leeds, United Kingdom",
  company: "Speechify",
  country: "United Kingdom",
  workplaceType: "Hybrid",
  isRemote: false,
});

assert.equal(
  buildContentDedupeFingerprint(gtmLeeds),
  buildContentDedupeFingerprint(gtmCambridge),
  "location suffix after spaced hyphen should not change dedupe fingerprint",
);
assert.equal(
  buildContentDedupeFingerprint(gtmLeeds),
  buildContentDedupeFingerprint(gtmPlain),
  "plain role title should match location-suffixed title",
);
assert.equal(
  buildContentDedupeFingerprint(gtmLeeds),
  buildContentDedupeFingerprint(gtmEmDash),
  "em dash location suffix should strip like spaced hyphen",
);
assert.equal(
  await computeContentDedupeHash(gtmLeeds),
  await computeContentDedupeHash(gtmCambridge),
  "location-suffixed titles should share content dedupe hash",
);

console.log("test-content-dedupe-hash: ok");
