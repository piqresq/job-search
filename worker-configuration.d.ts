interface Env {
  DB: D1Database;
  /** Durable coordinator for long-running pipeline orchestration. */
  PIPELINE_COORDINATOR: DurableObjectNamespace;
  /** Singleton dispatcher DO that fans out the cron poke to all active user coordinators. */
  PIPELINE_DISPATCHER: DurableObjectNamespace;
  /** Queue that executes one provider chunk at a time. */
  PIPELINE_QUEUE: Queue<import("./src/orchestration/types").PipelineQueueMessage>;
  /** Static files (`public/`) — dashboard UI and `/assets/*`. */
  ASSETS?: Fetcher;
  /** Generated CV / cover letter .docx (optional until bucket exists). */
  DOCS_BUCKET?: R2Bucket;
  /** Dashboard login username (non-secret). */
  DASHBOARD_USER?: string;
  /** Dashboard login password (use `wrangler secret put DASHBOARD_PASSWORD`). */
  DASHBOARD_PASSWORD?: string;
  /** Cloudflare Email Routing — soft-disabled in pipeline; binding optional if block commented out in wrangler. */
  SEND_EMAIL?: SendEmail;
  /** Single RapidAPI key (optional if `RAPIDAPI_KEYS` is set). */
  RAPIDAPI_KEY?: string;
  /** Comma- or newline-separated list; only the first key is used (extras ignored). */
  RAPIDAPI_KEYS?: string;
  OPENAI_API_KEY?: string;
  /** LinkedIn account email for Bright Data login (expiration scanner). */
  LINKEDIN_EMAIL?: string;
  /** LinkedIn account password for Bright Data login (expiration scanner). */
  LINKEDIN_PASSWORD?: string;
  /** Max invocations for Bright Data Browser API login (≥1). Default 6 when unset. `2` = one retry after first failure. */
  LINKEDIN_LOGIN_MAX_ATTEMPTS?: string;
  /** When `"true"`, login uses a single invocation (overrides `LINKEDIN_LOGIN_MAX_ATTEMPTS`). */
  LINKEDIN_LOGIN_NO_RETRY?: string;
  /** Bright Data account-level API key (for HTTP APIs; BD Browser auth is embedded in the WSS URL). */
  BRIGHTDATA_API_KEY?: string;
  /** Bright Data hosted Chromium WSS endpoint: wss://brd-customer-…@brd.superproxy.io:9222 */
  BRIGHTDATA_BROWSER_WS_ENDPOINT?: string;
  /** Bright Data ISP-proxy super-proxy host (default `brd.superproxy.io`). */
  BRIGHTDATA_ISP_PROXY_HOST?: string;
  /** Bright Data ISP-proxy super-proxy port as a string (default `"33335"`). */
  BRIGHTDATA_ISP_PROXY_PORT?: string;
  /** Bright Data ISP-proxy username: `brd-customer-<id>-zone-<zone_name>`. */
  BRIGHTDATA_ISP_PROXY_USERNAME?: string;
  /** Bright Data ISP-proxy password (per-zone). */
  BRIGHTDATA_ISP_PROXY_PASSWORD?: string;
  /** Browserbase account API key — header `X-BB-API-Key`. */
  BROWSERBASE_API_KEY?: string;
  /** Browserbase project ID (UUID) to bill the session to. */
  BROWSERBASE_PROJECT_ID?: string;
  /** `"true"` to request a Browserbase residential proxy (paid tier). Default off. */
  BROWSERBASE_USE_PROXIES?: string;
  /** Stealth mode: `""` (off, default), `"basic"`, or `"advanced"` (paid tier). */
  BROWSERBASE_STEALTH?: string;
  /** ISO-2 country to pin the LinkedIn login proxy/browser to (default `pl`). */
  LINKEDIN_AUTH_COUNTRY?: string;
  /** Scoring model (default gpt-5-mini; override in env). */
  OPENAI_MODEL?: string;
  /** CV + cover letter drafts (default gpt-5.5). */
  OPENAI_DRAFT_MODEL?: string;
  /** Reasoning effort for CV + cover letter drafts when the model supports it. */
  OPENAI_DRAFT_REASONING_EFFORT?: string;
  REVIEW_TOKEN_SECRET: string;
  RESEND_API_KEY?: string;
  REVIEW_EMAIL_TO?: string;
  REVIEW_EMAIL_FROM?: string;
  PUBLIC_BASE_URL?: string;
  ADMIN_RUN_KEY?: string;
  /**
   * Optional hard kill: only the string `"false"` blocks RapidAPI fetch regardless of the dashboard toggle.
   * Omit or `"true"` = dashboard Settings master switch controls extraction.
   */
  PIPELINE_FETCH_ENABLED?: string;
  /** Operational hours start in UTC (inclusive). Default 5. */
  PIPELINE_OPERATIONAL_START_UTC_HOUR?: string;
  /** Operational hours end in UTC (exclusive). Default 20. */
  PIPELINE_OPERATIONAL_END_UTC_HOUR?: string;
  ENABLED_JOB_SOURCES?: string;
  /** Legacy/manual query for diagnostics and tester defaults; pipeline role search now comes from dashboard settings. */
  JSEARCH_QUERY: string;
  /** JSearch path on `jsearch.p.rapidapi.com` (tester/diagnostics). */
  JSEARCH_API_PATH?: string;
  /** LinkedIn API path for tester/diagnostics. Runtime uses shared search policy (`/active-jb-24h`). */
  LINKEDIN_JOBS_API_PATH?: string;
  /** LinkedIn 24h/7d-style API: 10–100 jobs per call, default 100 (non-US). */
  LINKEDIN_JOBS_LIMIT?: string;
  /** Max paginated API pages per run when `LINKEDIN_LOCATION_FILTER` pins one country (default 15, max 50). */
  LINKEDIN_MAX_PAGES_PER_RUN?: string;
  /** Round-robin sweeps per pipeline run (each sweep = one page per active country). Default 8. */
  LINKEDIN_MAX_SWEEPS_PER_RUN?: string;
  /** Daily UTC budget for LinkedIn HTTP calls. */
  LINKEDIN_MAX_API_CALLS_PER_RUN?: string;
  /** Delay in ms between LinkedIn RapidAPI calls (default 400). */
  LINKEDIN_MS_BETWEEN_REQUESTS?: string;
  /** `true` — send `include_ai=true` (can break if vendor DB has errors). Default in wrangler is often `false` for stability. */
  LINKEDIN_INCLUDE_AI?: string;
  /** When rotation picks United States, use this limit (default 25). 10–100. */
  LINKEDIN_US_JOBS_LIMIT?: string;
  /** US once per N pipeline runs; other runs rotate non-US (default 5). */
  LINKEDIN_US_EVERY_N_RUNS?: string;
  /** Optional tester/diagnostic API `date_filter` (UTC) lower bound on `date_posted`. */
  LINKEDIN_DATE_FILTER?: string;
  /** Tester/diagnostic remote flag. Runtime uses shared search policy (always remote). */
  LINKEDIN_JOBS_REMOTE?: string;
  /** `text` | `html` | `none` (default text). */
  LINKEDIN_JOBS_DESCRIPTION_TYPE?: string;
  /** When not `false`, sends `agency=false` (non-agency companies only). */
  LINKEDIN_JOBS_COMPANY_ONLY?: string;
  /** Optional override for title search (else `JSEARCH_QUERY` / pipeline query). */
  LINKEDIN_TITLE_FILTER?: string;
  /** If set, skip country rotation and use this `location_filter` only. */
  LINKEDIN_LOCATION_FILTER?: string;
  /** Tester/diagnostic type filter. Runtime uses shared search policy (FULL_TIME). */
  LINKEDIN_TYPE_FILTER?: string;
  /** Tester/diagnostic JSearch date_posted enum. Runtime uses shared search policy (`today`). */
  JSEARCH_DATE_POSTED?: string;
  /** Tester/diagnostic JSearch employment_types. Runtime uses shared search policy (`FULLTIME`). */
  JSEARCH_EMPLOYMENT_TYPES?: string;
  /** Daily UTC budget for JSearch HTTP calls; 0/omitted disables the cap. */
  JSEARCH_MAX_API_CALLS_PER_RUN?: string;
  /** Manual tester default only; pipeline role search now comes from dashboard settings. */
  JOBS_API_QUERY?: string;
  /** Tester/diagnostic Jobs API `datePosted`. Runtime uses shared search policy (`day`). */
  JOBS_API_DATE_POSTED?: string;
  /** Tester/diagnostic Jobs API workplace types. Runtime uses shared search policy (`remote`). */
  JOBS_API_WORKPLACE_TYPES?: string;
  /** Tester/diagnostic Jobs API employment types. Runtime uses shared search policy (`fulltime`). */
  JOBS_API_EMPLOYMENT_TYPES?: string;
  /** US once per N Jobs API geo rotations (same idea as LinkedIn US cadence; default 5). */
  JOBS_API_US_EVERY_N_RUNS?: string;
  /** Daily UTC budget for Jobs API HTTP calls; 0/omitted disables the cap. */
  JOBS_API_MAX_API_CALLS_PER_RUN?: string;
  /** Max search rows to fetch details for per chunk (default 15, max 25). */
  JOBS_API_MAX_JOBS_PER_CHUNK?: string;
  /** Remote Jobs API path on `remote-jobs1.p.rapidapi.com` (default `/jobs`). */
  REMOTE_JOBS_API_PATH?: string;
  /** Manual tester default only; pipeline role search comes from dashboard settings. */
  REMOTE_JOBS_QUERY?: string;
  /** Per-sweep/day budget for Remote Jobs calls; default 250 so two sweeps fit 500/month. */
  REMOTE_JOBS_MAX_API_CALLS_PER_RUN?: string;
  /** Monthly safety budget for Remote Jobs calls; default 500. */
  REMOTE_JOBS_MAX_API_CALLS_PER_MONTH?: string;
  /** Rolling cooldown after a completed Remote Jobs sweep; default 15 days. */
  REMOTE_JOBS_MIN_DAYS_BETWEEN_RUNS?: string;
  /** Remote Jobs rows per API page/chunk, 1–100; default 100. */
  REMOTE_JOBS_MAX_JOBS_PER_CHUNK?: string;
  /**
   * When `"true"`, `/api/operational-signals` appends one synthetic low incident (message: "It's a dummy") for testing the pipeline header flip and ops UI.
   */
  DASHBOARD_DUMMY_LOW_INCIDENT?: string;
}
