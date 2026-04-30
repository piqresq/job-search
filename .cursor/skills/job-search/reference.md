# job-search — reference

## HTTP routes (`src/index.ts`)

| Method | Path | Notes |
|--------|------|--------|
| GET | `/` | JSON service hint |
| GET | `/health` | `ok` |
| POST | `/run` | Start / resume coordinator; requires admin auth if `ADMIN_RUN_KEY` |
| POST | `/test-email` | Mail test |
| POST | `/test-jsearch` | JSearch diagnostics JSON body optional |
| GET/POST | `/review` | Token in query; review UI |
| GET | `/dashboard` | Job dashboard (`dashboard.html` via ASSETS) |
| … | draft edit routes | See `index.ts` |

## Dashboard API (`src/dashboard/api.ts`, session cookie required)

| Method | Path | Notes |
|--------|------|-------|
| POST | `/api/auth/login` | JSON username/password → session cookie |
| POST | `/api/auth/logout` | Clears cookie |
| GET | `/api/settings` | `apiExtractionEnabled`, `verboseLoggingEnabled`, `pipelineHardKillActive`, **`cvCache`** (bundled vs D1-uploaded CV) |
| PATCH | `/api/settings` | Only fields present in body are updated (independent switches) |
| POST | `/api/settings/cv-upload` | Multipart **`.docx`** → mammoth extract → D1 `cv_source_*`; optional R2 `cv/latest.docx` |
| GET | `/api/logs?limit=` | Recent `app_logs` |
| DELETE | `/api/logs` | Deletes all `app_logs` rows |
| GET | `/api/jobs?tab=` | `active` \| `accepted` \| `denied` \| `filtered` — each job may include **`ingestionFacts`**, **`ingestionRequestParamsStored`** (Pipeline & extraction block) |
| GET | `/api/pipeline-status` | Coordinator status: `running` \| `paused` \| `sleeping`; optional `orchestrationError` (DO/queue, not vendor HTTP) |
| GET | `/api/statistics` | Dashboard **Statistics** tab: date range, KPIs, daily chart, vendor + role-variant rows (`src/dashboard/statistics.ts`); includes **`titleQueryHealthByVendor`** (full rollups). UI shows title health as one **mean-per-vendor** summary line (`src/metrics/titleQueryHealth/`, `src/db/titleQueryHealthStats.ts`). |
| GET | `/api/search-path-exhaustion` | Current coordinator **`cycleId`** + per-enabled-vendor planned-search tree: D1 `provider_country_state` / `provider_query_unit_state` exhaustion (`src/dashboard/searchPathExhaustion.ts`). Statistics UI: expandable horizontal pill tree. |
| POST | `/api/jobs/:id/accept` \| `/deny` | Dashboard decisions (UI: Applied / Reject) |
| POST | `/api/jobs/bulk-deny` | JSON `{ ids: string[] }` — deny listed ids among eligible rows |
| POST | `/api/jobs/bulk-accept` | JSON `{ ids: string[] }` — bulk Applied |
| POST | `/api/jobs/bulk-restore` | JSON `{ ids: string[] }` |
| POST | `/api/jobs/bulk-delete` | JSON `{ ids: string[] }` — hard delete (+ R2 cleanup where applicable) |
| POST | `/api/jobs/:id/restore` | Applied/Reject tabs: back to `active`; **Filtered** tab: `active` + `low_priority_review` + clear hard reject |
| POST | `/api/jobs/:id/generate` | Tailored DOCX |
| GET | `/api/jobs/:id/download/cv` \| `/cover` | DOCX download |

**Pipeline & extraction (expanded job row):** Rows are built from `jobs.normalized_json.ingestionRequestParams` only (HTTP GET path and query string as sent to the provider list/search call, plus Jobs API `detail_*` for the per-row GET). Not the raw API response body.

**Scoring (`scoring_json`):** `position_summary` is three sentences—one on the employer (when the posting gives company context), two on the role. See `src/pipeline/aiInstructionDefaults.ts`.

## Env bindings (`worker-configuration.d.ts` + secrets)

**Secrets (typical):** `RAPIDAPI_KEY`, `OPENAI_API_KEY`, `REVIEW_TOKEN_SECRET`; optional `RESEND_API_KEY`, `ADMIN_RUN_KEY`.

**Runtime bindings:** `PIPELINE_COORDINATOR` (Durable Object), `PIPELINE_QUEUE` (Queue producer / consumer), `DB`, `DOCS_BUCKET`, `ASSETS`.

## Orchestration (summary)

| Piece | Role |
|-------|------|
| `PipelineCoordinator` DO | Logical cycle, provider RR, enqueue one `provider_chunk` at a time, sleep/alarm, `orchestrationError` on DO/queue failures |
| `handlePipelineQueue` | Claim → `fetchChunk` → `/dedupe` → `processFetchedJobs` → `/report` → coordinator `pump` |
| `getPipelineFetchAllowed` | Hard kill off (`PIPELINE_FETCH_ENABLED` not the string `"false"`) **and** D1 `api_extraction_enabled` |
| Triggers | `PATCH /api/settings` (extraction on), `scheduled`, `POST /run` → `startOrResumeCoordinator` |

**LinkedIn-relevant vars:**

| Variable | Role |
|----------|------|
| `ENABLED_JOB_SOURCES` | Comma list: `linkedin_jobs`, `jsearch` |
| `LINKEDIN_JOBS_API_PATH` | e.g. `/active-jb-24h` (default), `/active-jb-7d` |
| `LINKEDIN_JOBS_LIMIT` | Non-US page size 10–100 (default 100) |
| `LINKEDIN_MAX_PAGES_PER_RUN` | Legacy one-shot run cap; not used by the Queue/DO orchestration path |
| `LINKEDIN_MAX_SWEEPS_PER_RUN` | Legacy one-shot run cap; not used by the Queue/DO orchestration path |
| `LINKEDIN_MAX_API_CALLS_PER_RUN` | Legacy one-shot run cap; not used by the Queue/DO orchestration path |
| `LINKEDIN_US_JOBS_LIMIT` | US page size (default 25) |
| `LINKEDIN_US_EVERY_N_RUNS` | US every Nth rotation (default 5) |
| `LINKEDIN_DATE_FILTER` | Optional API `date_filter` (UTC) |
| `LINKEDIN_JOBS_REMOTE` | Maps to API `remote` |
| `LINKEDIN_JOBS_COMPANY_ONLY` | When not false → `agency=false` |
| `LINKEDIN_TYPE_FILTER` | e.g. `FULL_TIME` |
| `LINKEDIN_TITLE_FILTER` | Overrides title if set |
| `LINKEDIN_LOCATION_FILTER` | Fixed location; disables country rotation |
| `LINKEDIN_JOBS_DESCRIPTION_TYPE` | `text` / `html` / `none` |
| `LINKEDIN_MS_BETWEEN_REQUESTS` | Earliest time before the next LinkedIn chunk is scheduled (default 400 ms; `0` allowed) |
| `LINKEDIN_INCLUDE_AI` | `"true"` → `include_ai=true` (often `"false"` in prod if vendor errors) |
| `PIPELINE_FETCH_ENABLED` | Hard kill only when value is **`"false"`** (string) |

**Shared query:** `JSEARCH_QUERY` feeds pipeline `query` and LinkedIn title fallback.

## D1 tables

- `jobs` — main store; unique `(source, external_id)`; see `0001_init.sql`. Optional **`content_dedupe_hash`** (SHA-256 prefix of normalized `company|title|workplace|country|employment|salary`) for cross-listing duplicate hard-rejects.
- `jsearch_rotation` — `id`, `seq` for JSearch geo rotation.
- `linkedin_country_offset` — `country`, `offset`, `drained`, `updated_at` (per-country LinkedIn pagination).
- `pipeline_state` — key/value: LinkedIn freeze until, RR start, sweep id, per-cycle provider request counts (`src/db/pipelineState.ts`).
- `app_settings` — dashboard toggles (`api_extraction_enabled`, `verbose_logging_enabled`); CV upload cache (`cv_source_text`, `cv_source_html`, `cv_uploaded_at_unix`).
- `app_logs` — persisted `log.*` output for Textbot (`DELETE /api/logs` clears all rows).

## LinkedIn rotation countries

Non-US list is in `src/db/linkedinCountryOffset.ts` (`LINKEDIN_NON_US_COUNTRIES`): United Kingdom, Switzerland, Norway, Iceland, Liechtenstein, Austria, Belgium, Bulgaria, Croatia, Cyprus, Czechia, Denmark, Estonia, Finland, France, Germany, Greece, Hungary, Ireland, Italy, Latvia, Lithuania, Luxembourg, Malta, Netherlands, Poland, Portugal, Romania, Slovakia, Slovenia, Spain, Sweden.

United States is **`LINKEDIN_COUNTRY_UNITED_STATES`**: appended to the rotated non-US list when **`includeUnitedStatesInLinkedinRun(sweepId, LINKEDIN_US_EVERY_N_RUNS)`** is true for that pipeline run (`src/providers/linkedinJobs.ts`).

## Cron

`wrangler.toml` `[triggers] crons` (default daily `0 0 * * *` UTC) → `scheduled` → coordinator start / resume. Enabling API extraction on the dashboard also starts / resumes the coordinator immediately. `POST /run` may require `ADMIN_RUN_KEY`.

## Fantastic Jobs billing (from their docs)

- **Jobs credits:** deducted by count of jobs returned in the response body.
- **Requests credits:** 1 per HTTP call.
- Rate limit headers: `x-ratelimit-jobs-*`, `x-ratelimit-requests-*`.

## Normalized job identity

- `stableJobId("linkedin_jobs", externalId)` where `externalId` is API `id` string.
- Upsert prevents duplicate rows; re-fetching same job updates `updated_at` and selected columns.

## Hard filters (pipeline)

- **`src/pipeline/hardFilters.ts`** — text/salary/language gates before OpenAI.
- **Jobs API (Pat92):** if `normalized_json.raw.detail.acceptingApplications === false`, hard reject (“not accepting applications”).

## Jobs API (Pat92) detail

- GET `/v2/linkedin/get?id=…` → `data` merged in `mergeJobsApiPat92` (`src/providers/jobsApi.ts`); response includes **`acceptingApplications`** (boolean).
