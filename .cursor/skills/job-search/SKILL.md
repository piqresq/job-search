---
name: job-search
description: Cloudflare Worker job-search pipeline (Fantastic Jobs LinkedIn 24h default, optional JSearch), D1, hard filters, OpenAI scoring, review email. Use when editing this repo, deploying, changing providers, filters, cron, or env vars.
---

# job-search (Cloudflare Worker)

## What this project does

1. **Orchestrated fetch:** **`PipelineCoordinator`** (Durable Object) schedules enabled providers with **weighted rotation based on resolved daily request caps** and sends **one chunk** per **`PIPELINE_QUEUE`** message (`src/orchestration/`). **API extraction** = D1 `api_extraction_enabled` plus **`getPipelineFetchAllowed`** (hard kill if `PIPELINE_FETCH_ENABLED` is **`"false"`**). Starting the coordinator: **`PATCH /api/settings`** (extraction on), **`scheduled`** (cron), **`POST /run`**. Queue consumer: claim → **`fetchChunk`** → cycle dedupe → **`processFetchedJobs`**. Coordinator routes: `/start`, `/claim`, `/dedupe`, `/report`, `/status`, `/orchestration-error`. **Paused** = extraction off or not scheduling; **sleeping** = cycle complete, alarm + cron poke next cycle. Dashboard: **`GET /api/pipeline-status`** for header state.
2. **Dedupe** in memory / coordinator, then **upsert** into D1 by `stableJobId(source, externalId)` (SHA-256 prefix). After upsert, **content-hash dedupe** rejects a second external id when the normalized role fingerprint matches an earlier saved row (`jobs.content_dedupe_hash`).
3. **Hard filters** (`src/pipeline/hardFilters.ts`) — deterministic gates before LLM cost (includes **Jobs API** `raw.detail.acceptingApplications === false` when detail exists).
4. **OpenAI** scoring + tailored CV/cover drafts (`src/pipeline/openaiScore.ts`, `generateDrafts.ts`).
5. **Review flow** — signed token, HTML pages, optional Cloudflare `send_email`.

Primary production source: **LinkedIn via Fantastic Jobs RapidAPI** (default **`active-jb-24h`**), not official LinkedIn.

## Layout (where to edit)

| Area | Path |
|------|------|
| HTTP routes, cron entry | `src/index.ts` |
| Dashboard UI + client JS | `public/dashboard.html` (bulk actions right-aligned; infinite scroll; expanded row “Pipeline & extraction”) |
| Dashboard JSON API (auth, jobs, settings, logs, pipeline status) | `src/dashboard/api.ts`, `src/dashboard/session.ts` |
| CV cache (D1 + mammoth upload) | `src/db/cvCache.ts`, `src/profile/cvSource.ts`, `src/profile/extractCvFromDocx.ts`; **`POST /api/settings/cv-upload`** |
| Ingestion request facts for dashboard | `src/dashboard/ingestionFacts.ts`, `src/lib/httpRequestParamsRecord.ts` (`NormalizedJob.ingestionRequestParams`) |
| OpenAI scoring instruction defaults | `src/pipeline/aiInstructionDefaults.ts` (`position_summary`: 1 sentence employer + 2 role); D1 merge `src/pipeline/aiInstructions.ts` |
| App logging → D1 | `src/logging/appLog.ts`, `src/db/appLogs.ts`, `src/db/appSettings.ts` |
| Pipeline orchestration | `src/orchestration/PipelineCoordinator.ts`, `src/orchestration/queueConsumer.ts`, `src/orchestration/client.ts` |
| Batch job processing helper | `src/pipeline/runPipeline.ts` (`processFetchedJobs` — content-hash dedupe, then hard filters, then OpenAI) |
| Hard filters | `src/pipeline/hardFilters.ts` |
| Statistics API + rollups | `src/dashboard/statistics.ts`, `src/db/statistics.ts`, `src/db/titleQueryHealthStats.ts` (title↔query health by vendor); scorer `src/metrics/titleQueryHealth/`; test `npm run test:title-query-health` |
| Provider registry | `src/providers/index.ts` (`getEnabledProviders`) |
| LinkedIn 7d + country rotation | `src/providers/linkedinJobs.ts`, `src/db/linkedinCountryOffset.ts` |
| Employment labels (multilingual + optional country hint → franc) | `src/providers/lib/employmentTypeCanonical.ts`, `providerFieldSemantics.ts` |
| Planned search (search + detail → job; merge gets `ctx`) | `src/providers/lib/plannedSearch.ts` |
| JSearch (legacy) | `src/providers/jsearch.ts`, `src/db/jsearchRotation.ts` |
| D1 job CRUD | `src/db/jobs.ts` |
| Types | `src/types/job.ts` (`JobSourceId`, `NormalizedJob`) |
| Migrations | `migrations/*.sql` |
| Local API tests | `scripts/run-hard-filter-test.ts`, `scripts/test-linkedin-sample.ts` |

## LinkedIn provider (24h endpoint by default)

- **Host:** `linkedin-job-search-api.p.rapidapi.com`
- **Path:** **`LINKEDIN_JOBS_API_PATH`** or default **`/active-jb-24h`** (max **100** jobs per request; each HTTP call = 1 request credit + jobs returned).
- **`order`:** not sent to the API (vendor bug with `order` on `/active-jb-24h`). Default response order is **newest first**; pagination uses `offset` as before.
- **US vs non-US:** `bumpLinkedinSweepId` (`pipeline_state`) gives a per-chunk id; **`includeUnitedStatesInLinkedinRun(runId, LINKEDIN_US_EVERY_N_RUNS)`** includes US once every Nth LinkedIn turn (default 5). **Non-US country order** continues via `getLinkedinRrStart` / `setLinkedinRrStart`.
- **Delay between LinkedIn turns:** **`LINKEDIN_MS_BETWEEN_REQUESTS`** (default 400 ms; `0` = none) now gates the earliest time the coordinator may schedule the next LinkedIn chunk.
- **`LINKEDIN_INCLUDE_AI`:** `"false"` in `wrangler.toml` when vendor breaks `include_ai` (see `docs/rapidapi-job-providers.md`).
- **US throttle:** when country is United States, **`LINKEDIN_US_JOBS_LIMIT`** (default 25) vs **`LINKEDIN_JOBS_LIMIT`** (default 100) for others.
- **Pagination / draining:** `linkedin_country_offset` stores `offset` per country. Each LinkedIn chunk fetches one page for one selected country; if the page returns **&lt; limit** rows that country is marked drained and offset resets to **0**. With API default **newest-first**, later pages are **older** listings.
- **Override:** if **`LINKEDIN_LOCATION_FILTER`** is set, skip rotation and use that string as sole `location_filter` (same offset key = that string).

## JSearch (optional)

- Enabled only if `jsearch` appears in `ENABLED_JOB_SOURCES`.
- EU/US mix via D1 `jsearch_rotation` + `jsearch_geo` sequence.

## Cron

`wrangler.toml` `[triggers] crons` (default **daily** `0 0 * * *` UTC) runs **`scheduled`** → **coordinator start/resume** (no `ADMIN_RUN_KEY`). Dashboard **API extraction on** also starts/resumes the coordinator immediately. **`POST /run`** may require admin auth when configured.

## Commands

```bash
npm run typecheck          # tsc --noEmit
npm run deploy             # wrangler deploy — run at end of task when Worker/dashboard/config changed
npx wrangler d1 migrations apply job-search-db --remote   # production D1 (before/with prod deploy)
npm run verify:local       # optional: typecheck + local D1 migrate + .dev.vars warnings (no server)
npm run dev                # optional: local wrangler dev (see AGENTS.md)
npm run dev:remote         # optional: wrangler dev --remote (prod bindings; risky)
npm run dev:wrangler       # optional: wrangler dev only
npm run d1:migrate:local   # optional: local D1 only
npm run test:linkedin-sample
npm run test:hard-filters
```

## Deploy checklist

1. `npx tsc --noEmit`
2. Apply **remote** D1 migrations if any new `migrations/*.sql`
3. `npm run deploy`
4. Secrets live in Cloudflare (`wrangler secret put`); never commit `.dev.vars`

**Auto-deploy (agents):** When you change `src/`, `public/`, `wrangler.toml`, or related build inputs, run **`npm run deploy`** at the end of the task without being asked—except pure-doc edits or if the user said not to deploy.

## Optional local dev (humans / debugging)

Copy **`.dev.vars.example`** → **`.dev.vars`** for `npm run dev`; Cloudflare does not return secret values after upload. **`npm run dev:remote`** uses production-backed bindings (use sparingly). Never commit `.dev.vars`.

## Conventions

- Match existing TypeScript style; minimal diffs; no drive-by refactors.
- **Do not** commit API keys or paste them into chat.
- After schema changes, add a new numbered migration; do not edit applied migrations.

## Extended reference

Env var tables, route list, and country array details: [reference.md](reference.md)
