# job-search

A personal, self-hosted job search automation system running on Cloudflare. It fetches job listings from multiple providers, filters and scores them with OpenAI against your CV, and presents them in a dashboard with an inbox for triage and a Kanban board for tracking active applications.

## What It Does

### Automated Pipeline

A scheduled pipeline (daily at 00:00 UTC by default) fetches listings from enabled job providers, deduplicates them, runs hard filters, and scores each listing with OpenAI. Ingestion is orchestrated by a **Durable Object + Queue** so it can run across many small steps without hitting Worker time limits.

Supported providers:

- **LinkedIn** (Fantastic Jobs RapidAPI, `/active-jb-24h` — jobs indexed in the last 24 hours, full-time remote)
- **JSearch** (RapidAPI, optional)
- **Jobs API** (Pat92 RapidAPI, optional)

Each provider is controlled by a daily request-cap budget, a per-country rotation, and a logical cycle so each run picks up where the last left off. Turning on **API extraction** from the dashboard starts the pipeline immediately; the daily cron restarts it automatically.

### AI Scoring

Every job that passes hard filters is scored by OpenAI:

- **Fit score** (0–100) with score bands: HIGH ≥ 85 · MEDIUM 75–84 · LOW 60–74 · FAILED < 60.
- **Position summary** — three sentences: one on the employer (what they do, size/stage if stated), two on the role.
- **Reasons to apply**, **risks**, and **recommendation**.
- **Title ↔ query health score** — measures how well the listing title matches the search query that found it; aggregated as a per-vendor quality signal in the Statistics tab.

### Dashboard

A single-page dashboard (`/dashboard`) covers the full workflow:

**Inbox tab** — lists all scored jobs with sort, filter, score badges, salary, employment type, country, and workplace type. Multi-select rows with Ctrl/Cmd and Shift for bulk actions: mark Applied, Reject, Restore, or Delete. Infinite scroll. Expanded row shows scoring details, position summary, AI-generated reasons/risks, ingestion request params, and links.

**Board tab** — Kanban board for tracking active applications across six columns: **New → Applying → Applied → Interview → Rejected → Expired**. Drag to reorder within a column; click column headers to move cards. Each card can open a cover-letter / CV generation drawer.

**Statistics tab** — intake and outcome KPIs, daily bar chart, per-vendor outcome bars, role-variant cards, and a title ↔ query health summary line per vendor.

**Operations tab** — live pipeline status (running / paused / sleeping), incident buckets (critical / moderate / low-priority anomalies), and a full Textbot log viewer (info/warn/error on the left; debug on the right). Clear logs with one click.

**Settings tab** — full configuration surface:
- API extraction toggle (on/off, with immediate pipeline start on enable)
- Enabled vendors and per-vendor daily request-cap overrides
- Job roles (Tier 1 / Tier 2, versioned with revision history)
- Search countries (select/deselect all, then save)
- Runtime search policy (remote-only, employment type, recency)
- OpenAI scoring and draft instructions (with revision history and reset to defaults)
- Scoring policy (salary floor, additional hard constraints)
- CV upload (`.docx`) — cached in D1, used by scoring and draft generation
- Verbose logging toggle
- Admin: multi-user management (create / suspend / delete users, role assignment, per-user provider caps)

### CV and Cover Letter Generation

Upload a `.docx` CV from Settings. When reviewing a job on the board, generate a tailored CV and cover letter with one click (GPT-5.5 high-reasoning). Generated `.docx` files are stored in R2 and downloadable from the board card.

### Daily Listing Expiration Scan _(in development)_

A nightly automated check that visits each job URL on your Kanban board (columns: New, Applying, Applied) and detects whether the listing is still live.

**How it works:**

- **LinkedIn listings** — fetches via a Bright Data ISP-proxy zone (static Polish residential IP) using stored LinkedIn session cookies. If the session cookie has expired (auth-wall redirect detected), it automatically falls back to a Bright Data Browser session (full Chromium with cookie injection) for the rest of that day's scan. If the Browser session also fails, the session is invalidated and the user sees a "re-login required" banner in the dashboard.
- **JSearch / other listings** — fetches publicly with a company-name probe (stage 1) followed by a country-hinted expiration phrase scan (stage 2, supports phrase lists for DE, ES, PT, FR, NL, IT and more).
- Any listing confidently detected as expired is moved automatically to the **Expired** Kanban column. Items in the Expired column are hard-deleted after 3 days.
- The scan respects a per-user toggle (`Settings → Board auto-expiration check`). Failures are surfaced in the Operations tab.

**LinkedIn session management** — a separate flow handles the LinkedIn cookie lifecycle. Login is performed via the Bright Data Browser API (Puppeteer/CDP against a real Chromium instance): the Worker navigates to `linkedin.com/login`, fills credentials, handles checkpoint detection, and stores the resulting cookie jar in D1. This session is used by both the expiration scan and the fallback scrape path.

### Setup Wizard

First-run wizard that recommends countries, role tiers, and initial settings based on your CV and job preferences.

---

## Stack

| Layer | Technology |
|---|---|
| Compute | Cloudflare Worker (TypeScript) |
| Orchestration | Cloudflare Durable Objects + Queues |
| Database | Cloudflare D1 (`job-search-db`) |
| Static assets | Cloudflare Worker Assets (`public/`) |
| Document storage | Cloudflare R2 (`job-search-docs`) |
| AI scoring & drafts | OpenAI API |
| LinkedIn login | Bright Data Browser API (Puppeteer/CDP) |
| LinkedIn expiration scan | Bright Data ISP Proxy (residential IP via `cloudflare:sockets`) |
| Job providers | RapidAPI (Fantastic Jobs LinkedIn, JSearch, Jobs API Pat92) |

---

## Clone On A New Machine

Requirements:

- Node.js 20+
- npm
- Git
- Cloudflare Wrangler auth (`npx wrangler login`)

```bash
git clone https://gitlab.com/piqresq/job-search.git
cd job-search
npm install
npm run verify:local
```

`npm run verify:local` typechecks the repo, creates `.dev.vars` from `.dev.vars.example` if missing, warns about empty secrets, and applies local D1 migrations. Start local dev with:

```bash
npm run dev
```

---

## Secrets

Local secrets live in `.dev.vars` (gitignored). Fill these for the full feature set:

```dotenv
OPENAI_API_KEY=
REVIEW_TOKEN_SECRET=
DASHBOARD_PASSWORD=
RAPIDAPI_KEY=
LINKEDIN_EMAIL=
LINKEDIN_PASSWORD=
BRIGHTDATA_API_KEY=
BRIGHTDATA_BROWSER_WS_ENDPOINT=
BRIGHTDATA_ISP_PROXY_USERNAME=
BRIGHTDATA_ISP_PROXY_PASSWORD=
```

Set production secrets with:

```bash
npx wrangler secret put OPENAI_API_KEY
npx wrangler secret put REVIEW_TOKEN_SECRET
npx wrangler secret put DASHBOARD_PASSWORD
npx wrangler secret put RAPIDAPI_KEY
npx wrangler secret put LINKEDIN_EMAIL
npx wrangler secret put LINKEDIN_PASSWORD
npx wrangler secret put BRIGHTDATA_API_KEY
npx wrangler secret put BRIGHTDATA_BROWSER_WS_ENDPOINT
npx wrangler secret put BRIGHTDATA_ISP_PROXY_USERNAME
npx wrangler secret put BRIGHTDATA_ISP_PROXY_PASSWORD
```

Cloudflare secret values cannot be pulled back from Cloudflare — keep your own secure copy.

---

## Database and Deploy

Apply new D1 migrations before deploying when `migrations/*.sql` changes:

```bash
npx wrangler d1 migrations apply job-search-db --remote
npm run deploy
```

For routine code or dashboard changes:

```bash
npm run typecheck
npm run deploy
```

---

## Useful Commands

```bash
npm run typecheck                 # TypeScript type check
npm run verify:local              # Typecheck + local D1 migrate + .dev.vars bootstrap
npm run dev                       # Local dev server (wrangler dev)
npm run dev:remote                # Local dev server against remote D1
npm run d1:migrate:local          # Apply migrations to local D1 only
npm run deploy                    # Build and deploy to Cloudflare

npm run test:hard-filters         # Run JSearch hard-filter smoke test
npm run test:jobs-api-merge       # Run Jobs API merge + acceptingApplications filter test
npm run test:title-query-health   # Run title ↔ query health scorer tests
```

---

## Project Layout

```
src/
  index.ts                   Worker entry point (fetch, scheduled, queue handlers)
  orchestration/             Durable Object coordinator + queue consumer
  pipeline/                  processFetchedJobs, scoring, hard filters, deduplication
  providers/                 LinkedIn, JSearch, Jobs API fetch + normalization
  dashboard/                 Dashboard API routes, statistics, salary, ingestion facts
  db/                        D1 helpers (jobs, board, settings, logs, stats, users)
  lib/                       LinkedIn auth, expiration scan, Bright Data integrations
  config/                    Countries, roles, search policy defaults
  metrics/                   Title ↔ query health scorer
  logging/                   Structured app logger (app_logs D1 table)
  notify/                    Email (review flow, soft-disabled)
  profile/                   CV extraction and scoring sanitization
  review/                    Review token generation and HTML
  setup/                     First-run setup wizard helpers
  types/                     Shared TypeScript types

public/
  dashboard.html             Single-file dashboard (HTML/CSS/JS)
  assets/                    Static assets (icons, fonts)

migrations/
  0001_init.sql … 0028_*.sql D1 schema migrations (apply in order)

scripts/
  linkedin_api_tester.py     Desktop GUI tester for all provider APIs
  *.ts                       Various local test / maintenance scripts

docs/
  rapidapi-job-providers.md  Vendor endpoints, params, credits reference
  backlog.md                 Future work items
```

---

## Notes

- Do not commit `.dev.vars`, API keys, tokens, generated local outputs, or local CV files.
- `wrangler.toml` contains non-secret production configuration and all binding names.
- Detailed architecture, orchestration flow, and operating notes are in `AGENTS.md`.
- Cursor-specific rules and skills live in `.cursor/`.
