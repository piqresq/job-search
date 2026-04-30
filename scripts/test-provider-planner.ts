import assert from "node:assert/strict";
import { buildSearchRoleQueryCache } from "../src/config/searchRoles";
import { SEARCH_COUNTRIES, SEARCH_COUNTRY_UNITED_STATES } from "../src/config/searchCountries";
import {
  buildConcatTierQueryUnits,
  resolvePlannerPaginationCommit,
  buildSingleRoleQueryUnits,
} from "../src/providers/lib/plannedSearch";
import { finalizeNormalizedJob } from "../src/providers/lib/normalizedJobValidation";

const tiers = {
  tier1: ["Technical Customer Success Manager", "Customer Success Manager"],
  tier2: ["Technical Support Manager"],
};

const single = buildSingleRoleQueryUnits(tiers);
assert.equal(single.length, 3);
assert.deepEqual(
  single.map((unit) => unit.tier),
  [1, 1, 2],
);

const concat = buildConcatTierQueryUnits(tiers, (roles) => roles.join(" OR "));
assert.equal(concat.length, 2);
assert.equal(concat[0]?.queryValue, "Technical Customer Success Manager OR Customer Success Manager");
assert.equal(concat[1]?.queryValue, "Technical Support Manager");

const normalCommit = resolvePlannerPaginationCommit({
  originalCursor: "page-1",
  nextCursor: "page-2",
  hydrationStoppedCycle: false,
});
assert.deepEqual(normalCommit, { paginationCursor: "page-2", exhausted: false });

const cappedMidPageCommit = resolvePlannerPaginationCommit({
  originalCursor: "page-1",
  nextCursor: "page-2",
  hydrationStoppedCycle: true,
});
assert.deepEqual(cappedMidPageCommit, { paginationCursor: "page-1", exhausted: false });

const cache = buildSearchRoleQueryCache(tiers);
assert.equal(
  cache.quotedOr.tier1,
  '"Technical Customer Success Manager" OR "Customer Success Manager"',
);
assert.equal(cache.quotedOr.tier2, '"Technical Support Manager"');

assert.equal(SEARCH_COUNTRIES[0]?.fullName, "United Kingdom");
assert.equal(SEARCH_COUNTRY_UNITED_STATES.iso2, "us");

const finalized = finalizeNormalizedJob(
  {
    source: "jobs_api",
    externalId: "job-1",
    title: "Customer Success Manager",
    company: "Acme",
    jobUrl: "https://example.com/job",
    applyUrl: "",
    location: "",
    country: undefined,
    isRemote: false,
    description: "Strong remote role.",
    raw: {},
  },
  {
    country: "United Kingdom",
    isRemote: true,
  },
);

assert.equal(finalized?.applyUrl, "https://example.com/job");
assert.equal(finalized?.location, "United Kingdom");
assert.equal(finalized?.country, "United Kingdom");
assert.equal(finalized?.isRemote, true);

const dropped = finalizeNormalizedJob(
  {
    source: "jobs_api",
    externalId: "job-2",
    title: "Customer Success Manager",
    company: "Acme",
    jobUrl: "https://example.com/job",
    applyUrl: "",
    location: "United Kingdom",
    country: undefined,
    isRemote: false,
    description: "",
    raw: {},
  },
  {
    country: "United Kingdom",
    isRemote: true,
  },
);

assert.equal(dropped, null);

console.log("test-provider-planner: ok");
