# AGENTS.md — context for AI assistants

This file is **project memory**: long-lived facts about `job-search` so agents (and humans) can onboard quickly. It duplicates and expands the Cursor skill in `.cursor/skills/job-search/`.

## Purpose

Automate **finding**, **filtering**, **scoring**, and **drafting application materials** for job listings, with human review. Data is stored in **Cloudflare D1**; compute runs on a **Cloudflare Worker**.

## Architecture (data flow)

1. **Scheduled / manual / dashboard enable trigger** → `**PipelineCoordinator` Durable Object** (`src/orchestration/PipelineCoordinator.ts`).
2. Coordinator enqueues **one provider chunk** onto `**PIPELINE_QUEUE`**; queue consumer runs in `src/orchestration/queueConsumer.ts`.
3. Provider chunk (`src/providers/`) returns `jobs + more/doneForCycle/nextEligibleAt`, updating provider-specific D1 state as it goes.
4. Queue consumer de-dupes the chunk against the current logical cycle, then calls `**processFetchedJobs**` (`src/pipeline/runPipeline.ts`).
5. For each kept job: `**stableJobId**` → check D1 `jobs` row; skip terminal statuses; `**upsertNormalizedJob**` → **content-hash dedupe** (same fingerprint as an earlier row → hard reject) → **hard filters** → **OpenAI score** → **save drafts** → optional review flow.

## API extraction — how it works (orchestration)

**Meaning:** “API extraction” is **fetching job listings from RapidAPI providers** (LinkedIn / JSearch), then **filtering + scoring** in this Worker. It is **not** a separate HTTP service — it is **orchestrated** by a **Durable Object + Queue** so work can continue across many small steps (Worker limits).

**Master switch (D1):** `app_settings.api_extraction_enabled` — read/written via `getApiExtractionEnabled` / `setApiExtractionEnabled` (`src/db/appSettings.ts`). `**getPipelineFetchAllowed`** combines this with optional wrangler `**PIPELINE_FETCH_ENABLED=false**` (hard kill).

**What starts the coordinator** (all call `startOrResumeCoordinator` → DO `**POST /start`** via `src/orchestration/client.ts`):


| Trigger                                    | Location                                                                                        |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| Dashboard **API extraction** turned **on** | `PATCH /api/settings` → `ctx.waitUntil(startOrResumeCoordinator(...))` (`src/dashboard/api.ts`) |
| **Cron** (default daily UTC)               | `scheduled` in `src/index.ts`                                                                   |
| `**POST /run`** (optional `ADMIN_RUN_KEY`) | `src/index.ts`                                                                                  |


**Durable Object (`PipelineCoordinator`):** Singleton stub name `**global`**. Holds **logical cycle** state (`cycleId`, provider weighted-rotation state based on resolved daily request caps, `pendingSeq` / `pendingProviderId`, `wakeAt`, per-provider `doneForCycle` / `nextEligibleAt`, cycle dedupe keys, `**orchestrationError`** for DO/queue/alarm failures — not vendor HTTP errors). Exposes internal routes: `/start`, `/claim`, `/dedupe`, `/report`, `/status`, `/orchestration-error`.

**Queue:** Messages are `**PipelineQueueMessage`** (`kind: provider_chunk`, `cycleId`, `seq`, `providerId`). The coordinator `**PIPELINE_QUEUE.send`s** one message per chunk; the Worker’s `**queue`** handler runs `**handlePipelineQueue**` (`src/orchestration/queueConsumer.ts`).

**One chunk’s path:**

1. Consumer `**/claim`** — if extraction is off or message is stale, chunk is skipped (no fetch).
2. `**provider.fetchChunk**` — RapidAPI call(s); providers may re-check `**isExtractionActive**`.
3. `**/dedupe**` — cycle-level URL dedupe (coordinator state).
4. `**processFetchedJobs**` — upsert, hard filters, OpenAI.
5. `**/report**` — coordinator updates provider state and runs `**pump**` again → either enqueue **next** chunk, **sleep** (~24h alarm when cycle complete), or **pause**.

**Pause vs sleep:** **Paused** = extraction not allowed (switch off / hard kill) or coordinator not scheduling. **Sleeping** = cycle finished for all enabled providers; **alarm** + daily cron can **poke** the next cycle.

**Dashboard status:** `GET /api/pipeline-status` (session) → `**getCoordinatorStatus`** → DO `**GET /status**`. Header UI in `public/dashboard.html` (dot + label; hidden until first load).

## Job identity and deduplication

- Internal primary key: `id` = first 32 hex chars of SHA-256(`source:externalId`).
- D1 unique index on `(source, external_id)`.
- Re-ingesting the same LinkedIn listing updates the row; does not create a second job.

## Employment type normalization

- `**canonicalizeEmploymentType**` / `**normalizeEmploymentType**` (`src/providers/lib/employmentTypeCanonical.ts`, `providerFieldSemantics.ts`) map vendor strings to dashboard labels (`Fulltime`, `Parttime`, etc.): phrase lists → ASCII tokens → **optional country-aware** language rules (ISO2 mapped to franc-style codes: DE/AT/LI, ES, PT, FR, NL, IT, CH multi, BE/LU multi, …) → `**franc-min`** fallback. **No external translation API**; if the country step does not classify the fragment, behavior matches the previous franc-only path.
- **Hints:** second argument `countryHint` — ISO2 or full country name resolvable via `findSearchCountryByIso2` / `findSearchCountryByName` (`src/config/searchCountries.ts`). **LinkedIn** passes normalized `country`; **JSearch** passes mapped ISO2 or raw `job_country`; **Jobs API** `mergeJobsApiPat92` receives `**ctx.country.iso2`** from planned search.

## Planned search provider merge

- `**runPlannedSearchProvider**` (`src/providers/lib/plannedSearch.ts`) calls `**merge(row, detail, ctx)**` with `**PlannedSearchContext**` (`ctx.country`, `ctx.queryUnit`, …). Implementations that ignore context use `(row, _detail, _ctx) => …`.

## LinkedIn integration (Fantastic Jobs, RapidAPI)

- **Not** an official LinkedIn API — third-party index of public job postings.
- **Endpoint used in code (default):** `GET https://linkedin-job-search-api.p.rapidapi.com/active-jb-24h` (jobs indexed in the last **24 hours**). Override with env `LINKEDIN_JOBS_API_PATH` (e.g. `/active-jb-7d`).
- **Limits:** 10–100 jobs per request (code clamps). `**/active-jb-6m`** allows up to 500 — not the default path.
- **Pagination:** Per country, D1 stores `offset`. In the Queue/DO orchestration path, each LinkedIn chunk fetches **one page for one selected country**, then the coordinator schedules the next provider turn until the logical cycle is exhausted.
- **Credits:** provider charges per **job returned** plus **one request** per call; design pagination and limits accordingly.
- **Country strategy:** one logical stream per **full country name** in `location_filter` (e.g. `United Kingdom`, not `UK`). Rotation + offsets are implemented in code; US is sampled less often and with a smaller page size than other countries.
- **LinkedIn `order`:** not sent (vendor: avoids PostgREST `idc` errors). API default is **newest first**; `offset` still walks through the result set until a short page marks a country drained.
- **US cadence:** `bumpLinkedinSweepId` in `pipeline_state` — US included once every `LINKEDIN_US_EVERY_N_RUNS` runs. **Non-US order** within a run: `getLinkedinRrStart` / `setLinkedinRrStart` rotate the country list (not `jsearch_rotation`).

## JSearch integration (optional)

- RapidAPI host `jsearch.p.rapidapi.com`.
- EU/US rotation via `jsearch_rotation` table and `jsearch_geo` sequence.
- Enable with `ENABLED_JOB_SOURCES` including `jsearch`.

## Configuration surface

- `**wrangler.toml`** — `[vars]` for non-secret config; `[[d1_databases]]`, `[[send_email]]`, `crons`.
- **Secrets** — `wrangler secret put <NAME>` for production; local `**.dev.vars`** (gitignored) mirrors names for `wrangler dev`.
- **Type definitions** — `worker-configuration.d.ts` should stay aligned with vars and bindings.

## Orchestration (bindings)

- **Coordinator:** singleton Durable Object binding `**PIPELINE_COORDINATOR`** (`export class PipelineCoordinator` from `src/index.ts`).
- **Executor:** Queue binding `**PIPELINE_QUEUE`** (producer in DO + consumer in same Worker `queue` export).
- **Logical cycle:** provider-level weighted rotation across `**ENABLED_JOB_SOURCES`**; weights come from resolved daily request caps (dashboard override or env default), while each provider keeps its own D1 cursors (LinkedIn countries, JSearch rotation, etc.).
- **Pause / resume:** turning **API extraction** off stops **new** chunks (`pump` / `claim`); in-flight chunk may finish. D1 offsets/freeze preserved — turning on again **continues** from saved state.
- **Sleep / wake:** when every enabled provider reports `**doneForCycle`** for the cycle, coordinator `**sleeping**` + `**alarm**`; cron still **pokes** `startOrResumeCoordinator` as a safety net.

## Database

- **Migrations** in `migrations/` applied in order (`0001_`, `0002_`, …).
- **Important tables:** `jobs` (includes optional **`content_dedupe_hash`** for fingerprint dedupe of duplicate listings across external ids), `jsearch_rotation`, `linkedin_country_offset`, `pipeline_state` (LinkedIn freeze `linkedin_freeze_until`, round-robin start, sweep id, per-cycle provider request counts for caps), `app_settings` (dashboard toggles + optional CV cache keys from upload), `app_logs` (persisted logger output for the dashboard Textbot), **`statistics_daily_*` rollups** (intake + outcomes; dashboard Statistics tab).

## Dashboard (`/dashboard`)

- **Static UI:** `public/dashboard.html` (served as `/dashboard` via Worker + ASSETS).
- **API:** `src/dashboard/api.ts` — session cookie auth (`src/dashboard/session.ts`).
- **Settings:** `GET` / `PATCH /api/settings` — `apiExtractionEnabled`, `verboseLoggingEnabled`, `pipelineHardKillActive` (true when wrangler var `PIPELINE_FETCH_ENABLED` is the string `"false"`; overrides dashboard extraction switch). `**GET /api/settings`** also returns `**cvCache**`. `**POST /api/settings/cv-upload**` (multipart `.docx`) caches mammoth text+HTML in D1 for scoring/drafts.
- **Logs:** `GET /api/logs` (optional `?limit=`), `DELETE /api/logs` — deletes **all** rows in `app_logs` (Textbot Clear). Logger: `src/logging/appLog.ts` (`log.info`/`warn`/`error`/`debug` always persist; `log.verbose` only if verbose switch on).
- **Textbot:** left column = `info`, `warn`, `error`, `verbose`; right = `debug` only. Refresh reloads from D1; opening Settings scrolls panels to newest lines.
- **Job tabs (UI copy):** **Applied** / **Reject** — still `?tab=accepted` / `?tab=denied` and D1 `dash_bucket` values `accepted` / `denied` (no rename in DB or API paths). Relevance tier **FILTER** (was “Rejected” label) is AI/hard reject; `**POST /api/jobs/:id/restore`** also restores a **filtered** row to active as **Low** (`low_priority_review`).
- **Switches:** each PATCH sends only the field that changed; no duplicate “verbose enabled” logs when toggling API extraction alone.
- **Immediate start on enable:** turning **API extraction** from off → on (via `PATCH /api/settings`) starts / resumes the **coordinator** immediately; it enqueues queue work if fetch is allowed.
- **Pipeline status:** `GET /api/pipeline-status` — coordinator `running` / `paused` / `sleeping` + optional `orchestrationError` for DO/queue failures (not provider HTTP). Header dot + label in `public/dashboard.html`.
- **Job list UX:** Multi-select rows (incl. Ctrl/Cmd and Shift range); **bulk action** bar is **right-aligned** (not centered). Per-tab actions include set Applied, reject, restore, hard delete where applicable (`POST /api/jobs/bulk-accept`, `bulk-deny`, `bulk-restore`, `bulk-delete` — **no browser confirm** on permanent delete). Infinite scroll loads more rows instead of a single “load more” control.
- **Job list — Date sort:** “Newest / Oldest” sorts by **pipeline ingest time** (`ingestedAtUnix` / API fetch) first, then vendor listing time, so ordering matches the date column and API-request tooltips.
- **Statistics tab:** `**GET /api/statistics**` (`src/dashboard/statistics.ts`) — KPIs, daily chart, **vendor** and **role variant** cards; vendor rows use the **same merged outcome bar + legend** as variants (request-scaled segments + zebra for extra API).
- **Title ↔ query health:** Deterministic 0–10 at ingest (`**scoreTitleToQueryHealth**`, `src/metrics/titleQueryHealth/`); stored on `**NormalizedJob**` as `**titleQueryHealthScore**` / `**titleQueryHealthBand**`; rollups from `**aggregateTitleQueryHealthByVendor**` (`src/db/titleQueryHealthStats.ts`, SQL window median + bounded example queries). **Statistics UI** shows one **global summary line** per window: comma-separated **`VendorLabel: averageScore`** (mean of stored scores for that vendor), not per-job rows. API payload still includes full `**titleQueryHealthByVendor**` (median, distribution, examples) for tooling.
- **Settings — Search countries:** **Select all** / **Deselect all** toggles every country checkbox before **Save countries** (still requires ≥1 selected to save).
- **Expanded row — “Pipeline & extraction”:** Shows **only HTTP request facts**, not API response fields. Persisted on each job as `**NormalizedJob.ingestionRequestParams`** (flat `method` / `host` / `path` / query keys as sent). Built for the API by `buildIngestionFactsFromNormalizedJson` (`src/dashboard/ingestionFacts.ts`) from `normalized_json`; list payload includes `**ingestionFacts**` and `**ingestionRequestParamsStored**`. Providers populate at fetch time via `flatHttpGetRequestRecord` (`src/lib/httpRequestParamsRecord.ts`): planned-search `**SearchPageResult.ingestionRequestParams**`, merged in `hydrateRows` (`src/providers/lib/plannedSearch.ts`); Jobs API `**merge**` adds `**detail_***` keys for the per-row GET. Older ingests without stored params get a short explanation in the UI.

## OpenAI scoring summary (`position_summary`)

- Stored in `**scoring_json.position_summary**`. **Exactly three sentences:** **one** on the **employer** (what the company does—products, industry, services; size, headcount, stage, funding **only if stated** in the posting); **two** on the **role** (duties, scope, context). Neutral facts; not candidate fit.
- Canonical wording lives in `**src/pipeline/aiInstructionDefaults.ts`** (`DEFAULT_OPENAI_SCORING_INSTRUCTION`). D1-stored instructions may be **one-time extended** by `**ensureCompanySentenceInPositionSummary`** in `**src/pipeline/aiInstructions.ts**` so existing deployments pick up the employer sentence without a manual reset.

## LinkedIn notes (ops)

- **Inter-request delay:** `LINKEDIN_MS_BETWEEN_REQUESTS` (default **400** ms) is now modeled as the earliest time the coordinator may schedule the **next LinkedIn chunk** after a page fetch. Set `0` to remove artificial spacing (RapidAPI limits still apply).
- `**LINKEDIN_INCLUDE_AI`:** default `**false`** in `wrangler.toml` when vendor `/active-jb-24h` returns PostgREST errors (e.g. `idc` column); see `**docs/rapidapi-job-providers.md**` troubleshooting. Set `"true"` again after upstream fix if you want AI-enriched fields.
- **Provider errors:** queue consumer logs provider errors and reports them back to the coordinator; LinkedIn offsets / freeze are not advanced on a thrown fetch error, and the provider is retried later from the same saved state.

## Cron

Cloudflare **cron triggers** the exported `**scheduled`** handler in `src/index.ts`, which now **pokes the coordinator** (default daily `0 0 * * *` UTC). That path does not use `ADMIN_RUN_KEY`. Use `**POST /run`** for manual start / resume when HTTP auth is required.

## Testing and operations

- **Typecheck:** `npm run typecheck`
- **Deploy:** `npm run deploy` (no longer runs `cv:extract`; optional `npm run cv:extract` updates bundled `src/profile/cv-extracted*.gen.ts` for fallback). **CV source of truth in prod:** dashboard **Settings → CV (WORD)** upload → D1 cache + R2 `cv/latest.docx`.
- **Agents (Cursor):** After edits that affect the Worker, dashboard assets (`public/`), pipeline, or config (`wrangler.toml`, `package.json`), **run `npm run deploy` automatically** when the task is done—do not wait for a separate “deploy” message unless the user asked to skip deploy or the change was documentation-only.
- **D1 prod:** `npx wrangler d1 migrations apply job-search-db --remote` when migrations change (before/with deploy).
- **Optional local tools (not required for agents):** **`npm run dev`** (`scripts/dev.mjs`: `.dev.vars` bootstrap if missing, local D1 migrate, `wrangler dev`), **`npm run dev:remote`** / **`dev:wrangler`**, **`npm run verify:local`**, **`npm run d1:migrate:local`**. See **`.dev.vars.example`**; secrets are not exportable from Cloudflare.
- **Scripts:** `scripts/test-linkedin-sample.ts` (LinkedIn 7d sample fetch), `scripts/run-hard-filter-test.ts` (JSearch + hard filters), **`npm run test:jobs-api-merge`** (Pat92 merge + acceptingApplications hard filter).
- **Logging:** `**log.moderate**` for statistics D1 write failures (intake/outcome/request counters) so they appear in **Moderate** incidents; pipeline content-dedupe failures use moderate; successful duplicate dedupe is not logged at low severity.

## User / product constraints (from project history)

- Prefer **rich LinkedIn-sourced data** over thin aggregator snippets where possible.
- **Remote** and **hard filters** reflect the owner’s job-search criteria; changing them changes who enters the scoring funnel. Hard filters include **Jobs API** detail `**acceptingApplications === false**` (listing not accepting applications) when `raw.detail` is present (`src/pipeline/hardFilters.ts`).
- **API keys** must be rotated if exposed; never embed in source or docs.

## Cursor-specific

- **Rule:** `.cursor/rules/job-search.mdc` (always on, short).
- **Skill:** `.cursor/skills/job-search/SKILL.md` + `reference.md` (detailed tables).
- **Backlog:** `docs/backlog.md` — follow-ups **after** shipped Queue/DO orchestration (e.g. richer dashboard coordinator panel, DLQ tuning).
- **User Memory:** For facts you want across *all* projects, copy distilled bullets into Cursor **Memory** manually (e.g. job-search stack, dashboard ingestion facts = request params only, `position_summary` = 1 employer + 2 role sentences); this repo’s source of truth for architecture remains `AGENTS.md` and the skill files.