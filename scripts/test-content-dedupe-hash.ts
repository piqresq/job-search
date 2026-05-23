/**
 * Unit tests for content dedupe fingerprints (no network).
 * Run: npm run test:content-dedupe-hash
 */
import assert from "node:assert/strict";
import {
  buildContentDedupeFingerprint,
  computeContentDedupeHash,
  computeCountryInclusiveContentDedupeHash,
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

console.log("test-content-dedupe-hash: ok");
