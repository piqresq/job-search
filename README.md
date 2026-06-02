# job-search

A self-hosted job search automation system on Cloudflare Workers. It fetches listings from RapidAPI job providers, deduplicates and hard-filters them, scores survivors with OpenAI against **your uploaded CV**, and surfaces everything in a multi-user dashboard with an inbox, a Filtered reject bucket, and a Kanban application board.

Production UI: **`/dashboard-v2`** (canonical). **`/dashboard`** still serves the legacy single-file UI for rollback only.

---

## What it does

### Automated pipeline

A **Durable Object + Queue** orchestrator runs ingestion in small chunks so work can continue across Worker limits. The daily cron (default **00:00 UTC**) pokes the pipeline; turning **API extraction** on in Settings starts it immediately.

Per enabled vendor, the coordinator applies:

- A **daily RapidAPI request budget** (dashboard override or `wrangler.toml` defaults)
- **Operational hours** (UTC window; outside it, new chunks pause)
- Provider-specific rotation (LinkedIn per-country offsets, JSearch geo, Jobs API geo, Remote Jobs sweep cadence)

Flow per chunk: **claim → fetch → cycle dedupe → `processFetchedJobs`** (content-hash dedupe, hard filters, optional ingest page checks, OpenAI score, persist).

**Job providers** (enable in **Settings → Vendors**; IDs in `src/providers/`):

| Provider | RapidAPI host | Notes |
|----------|---------------|--------|
| **LinkedIn** (`linkedin_jobs`) | Fantastic Jobs `linkedin-job-search-api` | Default `/active-jb-24h`, remote full-time; per-country rotation |
| **JSearch** (`jsearch`) | `jsearch.p.rapidapi.com` | Optional; EU/US rotation |
| **Jobs API** (`jobs_api`) | Pat92 `jobs-api14` | Optional; remote workplace filter at fetch |
| **Remote Jobs** (`remote_jobs`) | `remote-jobs1` | Optional; sweep + monthly caps; 15-day cooldown between full sweeps |

Vendor endpoints, params, and credits: **`docs/rapidapi-job-providers.md`**.

### Ingest-time listing checks

For **high** and **review** recommendations only (not low-priority or AI-rejected rows):

1. **Active listing** — one public fetch of the apply URL; confident “expired” copy → hard reject before the job appears in the inbox (`Listing no longer active at ingest`). No Bright Data spend on ingest.
2. **Workplace page** (Jobs API + LinkedIn HTML when available) — if the live page clearly contradicts the normalized workplace type (e.g. vendor said Remote but the page is on-site), hard reject with a filtered reason.

**Content-hash dedupe** — duplicate listings (same fingerprint within a **7-day** window) hard-reject against the earliest **anchor** row (active inbox or non-duplicate filtered rejects). Duplicate-listing filtered rows do not anchor later dupes.

### AI scoring

OpenAI scores jobs that pass hard filters:

- **Fit score** (0–100): HIGH ≥ 85 · MEDIUM 75–84 · LOW 60–74 · FAILED below 60
- **Position summary** — 3 sentences (1 employer, 2 role)
- **Reasons**, **risks**, **recommendation**
- **Title ↔ query health** (0–10) — per-vendor quality signal in Statistics

CV text for scoring comes from **Settings → CV upload** (D1 cache). There is **no** bundled CV in the repository.

### Dashboard (`/dashboard-v2`)

| Area | Purpose |
|------|---------|
| **Job List** | Scored inbox: sort, filters, bulk Applied / Reject / Restore / Delete, infinite scroll, expanded row (scoring, ingestion HTTP params, links) |
| **Board** | Kanban: **New → Applying → Applied → Interview → Rejected → Expired**; drag reorder; per-card CV/cover generation; manual “Refresh all” expiration check |
| **Filtered** | Hard/AI rejects with reason filters |
| **Statistics** | Intake/outcome KPIs, charts, vendor bars, title↔query health summary |
| **Operations** | Pipeline notice, vendor usage bars, expandable **search path exhaustion** tree (country or role grouping) |
| **Settings** | Extraction toggle, vendors & caps, roles & countries, runtime policy, scoring/draft instructions, scoring policy, **CV (.docx) upload**, board auto-expiration toggle, setup wizard re-run |
| **Admin** (admin role) | Users, per-user debug mode, verbose logging, refresh daily limits / resume after exhaustion, **Textbot** logs, incident buckets, **LinkedIn session** (`li_at`), pipeline status detail |

Multi-user auth: session cookie after `POST /api/auth/login`; jobs and settings are scoped per user.

### CV and tailored documents

1. Upload a **`.docx`** in Settings (mammoth → D1 `cv_source_*`; optional R2 `cv/latest.docx`).
2. On the board, generate tailored **CV** and **cover letter** (default draft model **gpt-5.5**, high reasoning).
3. Download generated **`.docx`** from R2 per job.

Local dev can refresh extract files with `npm run cv:extract` if you keep `Oleg_Velikanov_CV.docx` at the repo root — those outputs are **gitignored** and never required for deploy.

### Daily board expiration scan

Runs on the **daily cron** for board columns **New**, **Applying**, and **Applied** (when **Settings → Board auto-expiration check** is on):

- **LinkedIn URLs** — Bright Data ISP proxy + stored session cookies; auth-wall → Browser session for the rest of the day; persistent failure → invalidate session and show a re-login notice.
- **Other URLs** — public fetch + company probe + country-aware expired phrases (DE, ES, PT, FR, NL, IT, …).
- Confident expired → **Expired** column; **Expired** rows auto-delete after **3 days**.

LinkedIn login: Bright Data Browser (Puppeteer/CDP) or optional **Browserbase** (`BROWSERBASE_*` secrets) for “Connect LinkedIn” in Admin; manual `li_at` paste also supported.

### Setup wizard

First-run flow: upload CV, suggest countries/roles/tiers, seed settings from CV analysis (OpenAI).

---

## Stack

| Layer | Technology |
|-------|------------|
| Compute | Cloudflare Worker (TypeScript, `nodejs_compat`) |
| Orchestration | Durable Objects (`PipelineCoordinator`, `PipelineDispatcher`) + Queue |
| Database | D1 (`job-search-db`) |
| UI | Worker Assets — `public/dashboard-v2.html` |
| Documents | R2 (`job-search-docs`) |
| AI | OpenAI API |
| LinkedIn session / expiration | Bright Data Browser + ISP proxy; optional Browserbase |
| Listings | RapidAPI (see table above) |

---

## Clone and run locally

**Requirements:** Node.js 20+, npm, Git, `npx wrangler login`

```bash
git clone https://github.com/piqresq/job-search.git
cd job-search
npm install
npm run verify:local
npm run dev
```

`verify:local` typechecks, bootstraps `.dev.vars` from `.dev.vars.example` when missing, and applies **local** D1 migrations.

Open **`http://127.0.0.1:8787/dashboard-v2`** (or your `PUBLIC_BASE_URL`).

---

## Secrets

**Local:** `.dev.vars` (gitignored). Minimum to run scoring and dashboard login:

```dotenv
OPENAI_API_KEY=
REVIEW_TOKEN_SECRET=
DASHBOARD_PASSWORD=
RAPIDAPI_KEY=
```

**Full feature set** (add as needed):

```dotenv
LINKEDIN_EMAIL=
LINKEDIN_PASSWORD=
BRIGHTDATA_API_KEY=
BRIGHTDATA_BROWSER_WS_ENDPOINT=
BRIGHTDATA_ISP_PROXY_USERNAME=
BRIGHTDATA_ISP_PROXY_PASSWORD=
BROWSERBASE_API_KEY=
BROWSERBASE_PROJECT_ID=
ADMIN_RUN_KEY=
RESEND_API_KEY=
```

**Production:** `npx wrangler secret put <NAME>` — Cloudflare does not return secret values; keep your own backup.

`wrangler.toml` `[secrets].required` lists keys Wrangler expects for deploy; LinkedIn/Bright Data are only needed when you use expiration scan or automated LinkedIn login.

---

## Database and deploy

When `migrations/*.sql` changes:

```bash
npx wrangler d1 migrations apply job-search-db --remote
npm run typecheck
npm run deploy
```

Routine Worker or dashboard changes:

```bash
npm run typecheck
npm run deploy
```

---

## Useful commands

```bash
npm run typecheck
npm run verify:local
npm run dev
npm run dev:remote          # wrangler dev against remote D1
npm run d1:migrate:local
npm run deploy
npm run cv:extract          # optional: local .docx → gitignored cv-extracted*.gen.ts

npm run test:hard-filters
npm run test:jobs-api-merge
npm run test:content-dedupe-hash
npm run test:title-query-health
npm run test:ingest-workplace-page-check
npm run test:provider-regression
```

Desktop API tester (tabs built from Worker catalog): `python scripts/linkedin_api_tester.py` (or `scripts/api_tester.py`).

---

## Project layout

```
src/
  index.ts                 fetch, scheduled (pipeline + expiration scan), queue
  orchestration/           Coordinator, dispatcher, queue consumer
  pipeline/                processFetchedJobs, scoring, filters, dedupe, ingest checks
  providers/               linkedinJobs, jsearch, jobsApi, remoteJobs
  api/                     Provider tester catalog + URL builder (for Python GUI)
  dashboard/               Session auth, REST API, statistics, docx export
  db/                      jobs, board, settings, logs, users, pipeline state
  lib/                     LinkedIn session, expiration scan, Bright Data
  profile/                 CV source resolution (D1 only at runtime)
  metrics/                 title ↔ query health
  logging/                 app_logs → dashboard Textbot

public/
  dashboard-v2.html        canonical operator UI
  dashboard.html           legacy (deprecated for new work)
  assets/                  icons, fonts, vendor logos

migrations/                numbered D1 SQL (apply in order)
docs/                      rapidapi-job-providers.md, backlog.md
scripts/                   tests, cv:extract, API testers
```

---

## Privacy and repo hygiene

- **Never commit** `.dev.vars`, API keys, tokens, or personal CV files (`Oleg_Velikanov_CV.*`, generated `src/profile/cv-extracted*.gen.ts`).
- Production CV lives in **D1** (and optionally R2) after dashboard upload only.
- `wrangler.toml` holds non-secret bindings and default caps — not secret values.
- Architecture and operator detail: **`AGENTS.md`**. Cursor rules/skills: **`.cursor/`**.
