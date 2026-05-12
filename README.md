# job-search

Cloudflare Worker app that fetches job listings, filters and scores them with OpenAI, stores state in D1, and exposes a dashboard for review, Kanban board work, settings, and operations.

## Stack

- Cloudflare Worker + Assets
- Cloudflare D1 (`job-search-db`)
- Cloudflare Durable Objects and Queues for pipeline orchestration
- Cloudflare R2 (`job-search-docs`) for generated CV / cover documents
- TypeScript, Wrangler, plain HTML/CSS/JS dashboard assets

## Clone On A New Machine

Requirements:

- Node.js 20+
- npm
- Git
- Cloudflare Wrangler auth for deploys / remote resources (`npx wrangler login`)

```bash
git clone https://gitlab.com/piqresq/job-search.git
cd job-search
npm install
npm run verify:local
```

`npm run verify:local` typechecks the repo, creates `.dev.vars` from `.dev.vars.example` if missing, warns about empty secrets, and applies local D1 migrations. After that, start local dev with:

```bash
npm run dev
```

Local secrets live in `.dev.vars`, which is intentionally ignored by git. Fill these values for the full app:

```dotenv
RAPIDAPI_KEY=
OPENAI_API_KEY=
REVIEW_TOKEN_SECRET=
DASHBOARD_PASSWORD=
```

Cloudflare secret values cannot be pulled back from Cloudflare, so keep your own secure copy. Production secrets are set with:

```bash
npx wrangler secret put OPENAI_API_KEY
npx wrangler secret put REVIEW_TOKEN_SECRET
npx wrangler secret put DASHBOARD_PASSWORD
npx wrangler secret put RAPIDAPI_KEY
```

## Database And Deploy

Apply new production D1 migrations before deploying when `migrations/*.sql` changes:

```bash
npx wrangler d1 migrations apply job-search-db --remote
npm run deploy
```

For routine code/dashboard changes:

```bash
npm run typecheck
npm run deploy
```

## Useful Commands

```bash
npm run typecheck
npm run verify:local
npm run dev
npm run dev:remote
npm run d1:migrate:local
npm run test:hard-filters
npm run test:jobs-api-merge
npm run test:title-query-health
```

## Notes

- Do not commit `.dev.vars`, API keys, tokens, generated local outputs, or local CV files.
- `wrangler.toml` contains non-secret production configuration and binding names.
- Dashboard static assets live in `public/`.
- Worker and API code live under `src/`.
- More project-specific operating notes are in `AGENTS.md` and `.cursor/skills/job-search/`.
