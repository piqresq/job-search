# RapidAPI job providers (reference)

**Purpose:** Single source for Fantastic Jobs (LinkedIn Job Search) and JSearch—hosts, endpoints, params, responses, billing.  
**Code:** `src/providers/linkedinJobs.ts`, `src/providers/jsearch.ts`, `src/providers/rapidapiFetch.ts`.

**Optional verbatim pastes:** If you keep a full copy of vendor pages, use `docs/rapidapi-vendor-sources/` (see README there). You do **not** need a `.txt` unless you want a snapshot for yourself; this file is the maintained summary.

---

## 1. Fantastic Jobs — LinkedIn Job Search API

- **RapidAPI hub:** [LinkedIn Job Search API](https://rapidapi.com/fantastic-jobs-fantastic-jobs-default/api/linkedin-job-search-api/playground/apiendpoint_628cadc4-501b-4b98-ab46-46cace51d899)
- **HTTP host:** `linkedin-job-search-api.p.rapidapi.com`
- **Auth:** `X-RapidAPI-Key`, `X-RapidAPI-Host`

### Overview (vendor)

- High-volume LinkedIn-style listings; rich company and description fields.
- **Not** an official LinkedIn API; public job posting data only.
- Database indexes many jobs per hour; multiple time-window endpoints.
- Custom / high volume: **remco@fantastic.jobs**

### Endpoints (time slices)

| Path | Notes |
|------|--------|
| **24h** (`/active-jb-24h` — app default via `LINKEDIN_JOBS_API_PATH`) | Jobs **indexed** in last 24h (may include reposts; `date_posted` can be older). |
| **7d** | Indexed in last 7 days. |
| **6m** | Posted in last ~6 months; up to **500** jobs per request; refresh rules differ. |
| **Hourly / firehose** | Ultra & Mega plans. |
| **Get Expired Jobs** | Ultra & Mega; IDs expired previous day; **does not** consume job credits (vendor). |

`date_posted` is UTC; vendor notes **1–2 hour delay** before jobs appear. Use **`date_filter`** to require recent `date_posted`.

### Pagination and limits

- **`limit`** — 10–100 per call (default **100** if omitted on most endpoints). **`/active-jb-6m`** allows up to **500**.
- **`offset`** — Next page; vendor: offset should be a **multiple of `limit`** (e.g. 0, 100, 200 for `limit=100`).

### Search / text filters

| Param | Notes |
|--------|--------|
| **`title_filter`** | Google-style title search. |
| **`advanced_title_filter`** | Boolean ops: `&` `|` `!` `<->` `:*` (prefix). **Cannot** combine with `title_filter`. Multi-word phrases: single-quoted or `<->`. |
| **`location_filter`** | Full names (`United States`, not `US`). Multi: `Dubai OR Netherlands`. UK cities: include England/Wales/Scotland/NI, e.g. `Birmingham, England, United Kingdom`. |
| **`description_filter`** | Google-style on description. **Does not work for 6m.** On **7d**, risk of **timeouts**—vendor suggests low `limit` (e.g. 10), low `offset`; prefer **24h or hourly** for heavy description filters. |
| **`organization_description_filter`** | Search company LinkedIn description. Not for 6m. |
| **`organization_specialties_filter`** | Company specialties. Not for 6m. |
| **`organization_slug_filter`** | Exact slug(s), comma **no spaces**: `microsoft,tesla-motors`. Slug = company URL segment after `/company/`. |
| **`organization_filter`** | Exact company **names**, comma no spaces. **Parentheses in names** can break; vendor prefers **`organization_slug_filter`**. |

### Job / org attributes

| Param | Notes |
|--------|--------|
| **`description_type`** | Omit = no description body. `text` = plain text; `html` = raw HTML (sanitize if you render). |
| **`type_filter`** | `CONTRACTOR`, `FULL_TIME`, `INTERN`, `OTHER`, `PART_TIME`, `TEMPORARY`, `VOLUNTEER` — comma, **no spaces**. |
| **`remote`** | `true` = remote only; `false` = non-remote; omit = both. Derived field. |
| **`agency`** | `true` = only agencies/job boards; `false` = only regular companies. |
| **`industry_filter`** | Exact LinkedIn industry, **case sensitive**, English. Comma list no spaces; comma **inside** industry: double-quote, e.g. `"Air, Water, and Waste Program Management"`. |
| **`seniority_filter`** | Exact LinkedIn seniority, case sensitive. English examples: `Associate`, `Director`, `Executive`, `Mid-Senior level`, `Entry level`, `Not Applicable`, `Internship`. Comma, no spaces. `Not Applicable` may drop relevant rows. |
| **`employees_lte` / `employees_gte`** | Company size filters; defaults 0. |

### Dedup / apply / ATS (vendor semantics)

| Param | Notes |
|--------|--------|
| **`exclude_ats_duplicate`** | `true` removes **many** dupes vs **Active Jobs DB** API only—not general dedup. |
| **`external_apply_url`** | `true` = only jobs with external apply URL (may include trackers). |
| **`directapply`** | Easy Apply on LinkedIn; complementary to ATS API per vendor. |

### Ordering and date

- **`order`** — This app **does not send** `order` on LinkedIn requests: Fantastic Jobs confirmed PostgREST errors (e.g. `idc`) when `order` is set on `/active-jb-24h`. The API’s **default** sort is **newest `date_posted` first**; we paginate with **`offset`** (larger offset = older rows within the filtered slice). Do not reintroduce `order` without re-validating with the vendor.
- **`date_filter`** — “Greater than” filter on `date_posted`; optional time: `2025-01-01T14:00:00` UTC.

### AI (BETA)

- **`include_ai`** — `true` adds AI-extracted fields for **non-agency** tech/product-style roles (vendor). Requires **`include_ai=true`** for several filters below.
- **`ai_work_arrangement_filter`** — `On-site`, `Hybrid`, `Remote OK`, `Remote Solely` — comma, no spaces.
- **`ai_experience_level_filter`** — `0-2`, `2-5`, `5-10`, `10+` — comma, no spaces.
- **`ai_visa_sponsorship_filter`** — Boolean.
- **`ai_taxonomies_a_filter`** / **`_primary_`** / **`_exclusion_`** — Top-level taxonomies (long list in vendor docs: Technology, Healthcare, …). Comma, no spaces; `&` in name → double-quote.
- **`ai_education_requirements_filter`** — Per vendor table.
- **`ai_has_salary`** — Only jobs with salary in `salary_raw` or AI-extracted; use with `include_ai=true`.

Vendor notes: AI enrichment excludes many recruitment-agency listings.

**Troubleshooting:** If `/active-jb-24h` returns JSON like `column active_jb_jobs_24h.idc does not exist` (PostgREST), that is a **vendor-side SQL/view typo** (`idc` vs `id`). Try **`include_ai=false`** (in this repo: `LINKEDIN_INCLUDE_AI=false` in `wrangler.toml`) and redeploy; re-enable when Fantastic Jobs fixes upstream.

### Credits and headers

- Each call: **1 request credit** + **jobs returned** count toward **job** credits.
- Typical headers: `x-ratelimit-jobs-limit`, `x-ratelimit-jobs-remaining`, `x-ratelimit-requests-limit`, `x-ratelimit-requests-remaining`, `x-ratelimit-jobs-reset` (seconds to reset, etc.).

### Response

- **Success:** JSON **array** of job objects (our code expects an array).
- **Failure:** May be JSON **object** with `message` / upstream error (not always a clean HTTP error).

### Representative output fields (names vary slightly; see vendor playground)

Core: `id`, `title`, `organization`, `organization_url`, `date_posted`, `date_created`, `url`, `description_text` (if requested), `employment_type`, `locations_raw`, `locations_derived`, `countries_derived`, `regions_derived`, `cities_derived`, `remote_derived`, `seniority`, `directapply`, `salary_raw`, `linkedin_org_*`, `ats_duplicate`, `external_apply_url`, `include_ai` block when enabled, etc.

**Vendor doc inconsistency:** Sections disagree on default ordering; in production we **omit** `order` and assume **newest-first** for pagination semantics.

### Dedup strategy (vendor)

- Run **24h** at the **same time daily**; **7d** same time weekly—reduces re-fetching the same discovery window.
- Combine filters (e.g. multiple locations in one request) when possible.

---

## 2. JSearch (OpenWeb Ninja)

- **RapidAPI hub:** [JSearch](https://rapidapi.com/letscrape-6bRBa3QguO5/api/jsearch/playground/endpoint_f2b4c6e5-2763-450a-a8b2-1e80961e880d)
- **HTTP host:** `jsearch.p.rapidapi.com`
- **Auth:** `X-RapidAPI-Key`, `X-RapidAPI-Host: jsearch.p.rapidapi.com`

### Endpoints

| Path | Role |
|------|------|
| `/search` | Main search (Google for Jobs–style aggregate). |
| `/job-details` | Detail by id (+ reviews / extra apply options per vendor). |
| `/estimated-salary` | Estimates by title + location. |
| `/company-job-salary` | Salary at a company for a title (+ optional location). |

### `/search` parameters

| Param | Notes |
|--------|--------|
| **`query`** | **Required.** Free text; vendor recommends **title + location** in the string. |
| **`page`** | 1–50 (default 1). ~**10 results per page**. |
| **`num_pages`** | 1–50 pages returned starting at `page`; **each page costs request quota**. |
| **`country`** | ISO 3166-1 alpha-2 (default `us`). Use for country-specific results (e.g. Berlin + `de`). |
| **`language`** | ISO 639; empty = primary language for country. |
| **`location`** | Optional; Google UULE-style location string. |
| **`date_posted`** | `all` (default), `today`, `3days`, `week`, `month`. |
| **`work_from_home`** | Remote-only. |
| **`employment_types`** | Comma list: `FULLTIME`, `CONTRACTOR`, `PARTTIME`, `INTERN`. |
| **`job_requirements`** | e.g. `under_3_years_experience`, `more_than_3_years_experience`, `no_experience`, `no_degree`. |
| **`radius`** | km from query location (best-effort per vendor). |
| **`exclude_job_publishers`** | Comma publishers to exclude. |
| **`fields`** | Comma field projection (optional). |

### Response envelope

```json
{
  "status": "OK",
  "request_id": "...",
  "parameters": { },
  "data": [ ]
}
```

Errors:

```json
{
  "status": "ERROR",
  "request_id": "...",
  "error": { "message": "...", "code": 400 }
}
```

RapidAPI gateway may return `{ "message": "..." }` only (e.g. 403, 429).

### Plans and limits (typical)

- **BASIC:** ~200 **monthly** requests (hard cap on free tier per vendor docs); **1000 req/hour** cap on free RapidAPI plans.
- Paid: PRO / ULTRA / MEGA — see hub pricing.
- Headers: `x-ratelimit-requests-limit`, `x-ratelimit-requests-remaining`, `x-ratelimit-requests-reset`.

### Support

- **support@openwebninja.com** — high volume / Mega noted on hub.

---

## 3. This repo

| Provider ID | Module | Host |
|-------------|--------|------|
| `linkedin_jobs` | `linkedinJobs.ts` | Fantastic Jobs |
| `jsearch` | `jsearch.ts` | JSearch |

RapidAPI requests use the **first** configured key only (`RAPIDAPI_KEY` / `RAPIDAPI_KEYS`); see `src/providers/rapidapiFetch.ts`.

---

*Verify pricing and caps on the live RapidAPI subscription pages; vendor text changes over time.*
