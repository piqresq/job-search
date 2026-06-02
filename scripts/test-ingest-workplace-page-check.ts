/**
 * Unit tests for ingest workplace page verification (no network).
 * Run: npm run test:ingest-workplace-page-check
 */
import assert from "node:assert/strict";
import {
  checkWorkplaceOnPageAtIngest,
  extractLinkedInListingWorkplaceBlob,
  ingestWorkplacePageMismatchReason,
  INGEST_WORKPLACE_PAGE_MISMATCH_PREFIX,
  pageConfirmsConflictingWorkplaceType,
  pageConfirmsWorkplaceType,
  pageMentionsAnyWorkplaceType,
} from "../src/pipeline/ingestWorkplacePageCheck";
import type { NormalizedJob } from "../src/types/job";

const remoteJob: NormalizedJob = {
  source: "jobs_api",
  externalId: "1",
  title: "Engineer",
  company: "Co",
  jobUrl: "https://www.linkedin.com/jobs/view/1",
  applyUrl: "https://www.linkedin.com/jobs/view/1",
  location: "UK",
  isRemote: true,
  description: "Remote role",
  workplaceType: "Remote",
  raw: {},
};

const hybridJob: NormalizedJob = { ...remoteJob, workplaceType: "Hybrid" };
const officeJob: NormalizedJob = { ...remoteJob, workplaceType: "Office", isRemote: false };

assert.equal(pageConfirmsWorkplaceType('<span>Workplace type: Remote</span>', "Remote"), true);
assert.equal(pageConfirmsWorkplaceType('{"jobLocationType":"TELECOMMUTE"}', "Remote"), true);
assert.equal(pageConfirmsWorkplaceType("<p>work from home available</p>", "Remote"), true);
assert.equal(pageConfirmsWorkplaceType('{"workplaceTypes":["Remote"]}', "Remote"), true);
assert.equal(pageConfirmsWorkplaceType("<p>teletravail possible</p>", "Remote"), true);
assert.equal(pageConfirmsWorkplaceType("<p>not remote — on-site only</p>", "Remote"), false);
assert.equal(pageConfirmsWorkplaceType("<p>On-site required in London</p>", "Remote"), false);

assert.equal(pageConfirmsWorkplaceType("<p>Hybrid role — 3 days office</p>", "Hybrid"), true);
assert.equal(pageConfirmsWorkplaceType("<p>Fully on-site</p>", "Hybrid"), false);

assert.equal(pageConfirmsWorkplaceType("<p>100% on-site in Berlin</p>", "Office"), true);
assert.equal(pageConfirmsWorkplaceType("<p>Office-based team</p>", "Office"), true);
assert.equal(pageConfirmsWorkplaceType("<p>Remote-first company</p>", "Office"), false);

assert.equal(extractLinkedInListingWorkplaceBlob('{"workplaceTypes":["Remote"]}'), "Remote");
assert.equal(extractLinkedInListingWorkplaceBlob('{"jobLocationType":"TELECOMMUTE"}'), "TELECOMMUTE");
assert.equal(
  extractLinkedInListingWorkplaceBlob(
    '<p>Senior engineer.</p><script>{"officeLocation":{"city":"London"}}</script>',
  ),
  null,
);
assert.equal(
  extractLinkedInListingWorkplaceBlob('<nav>Browse remote jobs</nav><p>Senior engineer in London.</p>'),
  null,
);
assert.equal(extractLinkedInListingWorkplaceBlob("<ul><li>On-site</li></ul>"), "On-site");

assert.equal(checkWorkplaceOnPageAtIngest(remoteJob, '{"workplaceTypes":["Remote"]}'), "pass");
assert.equal(checkWorkplaceOnPageAtIngest(remoteJob, "<ul><li>On-site</li></ul>"), "reject");
assert.equal(
  checkWorkplaceOnPageAtIngest(
    remoteJob,
    "<p>We are hiring a senior engineer. Responsibilities include API design.</p>",
  ),
  "skip",
);
assert.equal(
  checkWorkplaceOnPageAtIngest(
    remoteJob,
    '<nav>Browse remote jobs</nav><p>Senior engineer in London. Full-time.</p>',
  ),
  "skip",
);
assert.equal(
  checkWorkplaceOnPageAtIngest(
    remoteJob,
    '<p>Senior engineer in London.</p><script>{"officeLocation":{"city":"London"}}</script>',
  ),
  "skip",
);
assert.equal(
  checkWorkplaceOnPageAtIngest(remoteJob, "<p>On-site required in London</p>"),
  "skip",
);
assert.equal(pageConfirmsConflictingWorkplaceType("<div>On-site only</div>", "Remote"), true);
assert.equal(
  pageConfirmsConflictingWorkplaceType(
    '<p>Senior engineer in London.</p><script>{"officeLocation":{"city":"London"}}</script>',
    "Remote",
  ),
  false,
);
assert.equal(pageMentionsAnyWorkplaceType("<p>We are hiring a senior engineer.</p>"), false);
assert.equal(pageMentionsAnyWorkplaceType("<p>Hybrid schedule</p>"), true);
assert.equal(checkWorkplaceOnPageAtIngest(hybridJob, '{"workplaceTypes":["Hybrid"]}'), "pass");
assert.equal(checkWorkplaceOnPageAtIngest(officeJob, "<span>On-site</span>"), "pass");
assert.equal(checkWorkplaceOnPageAtIngest(remoteJob, null), "skip");
assert.equal(checkWorkplaceOnPageAtIngest(remoteJob, ""), "skip");
assert.equal(checkWorkplaceOnPageAtIngest({ ...remoteJob, source: "linkedin_jobs" }, '{"workplaceTypes":["Remote"]}'), "skip");
assert.equal(checkWorkplaceOnPageAtIngest({ ...remoteJob, workplaceType: undefined }, '{"workplaceTypes":["Remote"]}'), "skip");

const reason = ingestWorkplacePageMismatchReason("Remote");
assert.ok(reason.includes(INGEST_WORKPLACE_PAGE_MISMATCH_PREFIX));
assert.ok(reason.includes("(Remote)"));
assert.ok(reason.toLowerCase().includes("workplace not confirmed on listing page at ingest"));

console.log("test-ingest-workplace-page-check: ok");
