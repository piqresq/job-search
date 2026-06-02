import { buildProviderTesterUrl } from "./api/providerTesterBuilder";
import { getProviderTesterCatalog } from "./api/providerTesterCatalog";
import { getProviderTesterDefaults } from "./api/providerTesterDefaults";
import { handleDashboardApi } from "./dashboard/api";
import { log } from "./logging/appLog";
import { clearExhaustPause, startOrResumeCoordinator } from "./orchestration/client";
import { PipelineCoordinator } from "./orchestration/PipelineCoordinator";
import { PipelineDispatcher } from "./orchestration/PipelineDispatcher";
import { handlePipelineQueue } from "./orchestration/queueConsumer";
import { purgeExpiredDashboardJobs } from "./dashboard/retention";
import { runDailyExpirationScan } from "./lib/expirationScanner";
import { purgeExpiredBoardItemsHardDelete } from "./db/jobBoard";
import { ensureFresh } from "./lib/linkedinSessionService";
import { listActiveUserIds } from "./db/users";
import {
  backfillSalaryEurCacheBatch,
  countJobsMissingSalaryEurCache,
  getJobFull,
  setJobStatus,
  updateDrafts,
} from "./db/jobs";
import { BOOTSTRAP_ADMIN_ID } from "./db/users";
import { fetchUsdGbpToEurRates } from "./pipeline/hardFilters";
import { sendCloudflareEmailTest } from "./notify/email";
import { fetchJsearchDiagnostics, type JsearchDiagnosticsOverrides } from "./providers/jsearch";
import { editPageHtml, reviewPageHtml } from "./review/html";
import { verifyReviewToken } from "./review/tokens";
import { fitPriorityLabel, type JobSourceId } from "./types/job";

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/") {
      return new Response(
        JSON.stringify({
          ok: true,
          service: "job-search",
          hint:
            "GET /dashboard — job UI (login) | GET /api/provider-tester — RapidAPI tester schema + defaults (no auth) | GET /api/provider-tester-defaults — legacy JSON only | POST /api/provider-tester/build-url — tester URL (no auth) | POST /run | POST /test-email | POST /test-jsearch (optional JSON; same auth as /run)",
        }),
        { headers: { "content-type": "application/json" } },
      );
    }

    if (request.method === "GET" && url.pathname === "/health") {
      return new Response("ok", { status: 200 });
    }

    /** Full catalog (fields + defaults) for `scripts/linkedin_api_tester.py` — tabs/forms built from JSON. */
    if (request.method === "GET" && url.pathname === "/api/provider-tester") {
      const body = await getProviderTesterCatalog(env);
      return new Response(JSON.stringify(body, null, 2), {
        headers: {
          "content-type": "application/json; charset=utf-8",
          "cache-control": "no-store",
        },
      });
    }

    /** Legacy shape `{ linkedin, jsearch, publicBaseUrl }` — prefer GET /api/provider-tester. */
    if (request.method === "GET" && url.pathname === "/api/provider-tester-defaults") {
      const body = await getProviderTesterDefaults(env);
      return new Response(JSON.stringify(body, null, 2), {
        headers: {
          "content-type": "application/json; charset=utf-8",
          "cache-control": "no-store",
        },
      });
    }

    /** Build RapidAPI GET URL from provider id + params (same rules as pipeline). */
    if (request.method === "POST" && url.pathname === "/api/provider-tester/build-url") {
      let json: unknown;
      try {
        json = await request.json();
      } catch {
        return new Response(JSON.stringify({ ok: false, error: "Invalid JSON body" }), {
          status: 400,
          headers: { "content-type": "application/json; charset=utf-8" },
        });
      }
      if (!json || typeof json !== "object") {
        return new Response(JSON.stringify({ ok: false, error: "Expected JSON object" }), {
          status: 400,
          headers: { "content-type": "application/json; charset=utf-8" },
        });
      }
      const o = json as Record<string, unknown>;
      const providerId = (o.providerId ?? o.provider_id) as string | undefined;
      const params = o.params;
      if (typeof providerId !== "string" || !providerId.trim()) {
        return new Response(JSON.stringify({ ok: false, error: "Missing providerId" }), {
          status: 400,
          headers: { "content-type": "application/json; charset=utf-8" },
        });
      }
      if (!params || typeof params !== "object" || Array.isArray(params)) {
        return new Response(JSON.stringify({ ok: false, error: "Missing params object" }), {
          status: 400,
          headers: { "content-type": "application/json; charset=utf-8" },
        });
      }
      const id = providerId.trim() as JobSourceId;
      if (id !== "linkedin_jobs" && id !== "jsearch" && id !== "jobs_api" && id !== "remote_jobs") {
        return new Response(JSON.stringify({ ok: false, error: `Unknown providerId: ${providerId}` }), {
          status: 400,
          headers: { "content-type": "application/json; charset=utf-8" },
        });
      }
      const result = buildProviderTesterUrl(id, params as Record<string, unknown>);
      const status = result.ok ? 200 : 400;
      return new Response(JSON.stringify(result), {
        status,
        headers: { "content-type": "application/json; charset=utf-8" },
      });
    }

    const dashRes = await handleDashboardApi(env, request, url, ctx);
    if (dashRes) return dashRes;

    if (url.pathname.startsWith("/assets/")) {
      if (!env.ASSETS) return new Response("ASSETS not configured", { status: 503 });
      return env.ASSETS.fetch(request);
    }

    if (
      (url.pathname === "/dashboard" || url.pathname === "/dashboard/") &&
      request.method === "GET"
    ) {
      if (!env.ASSETS) return new Response("ASSETS not configured", { status: 503 });
      const assetUrl = new URL(request.url);
      assetUrl.pathname = "/dashboard.html";
      return env.ASSETS.fetch(new Request(assetUrl.toString(), request));
    }

    if (
      (url.pathname === "/dashboard-v2" || url.pathname === "/dashboard-v2/") &&
      request.method === "GET"
    ) {
      if (!env.ASSETS) return new Response("ASSETS not configured", { status: 503 });
      const assetUrl = new URL(request.url);
      assetUrl.pathname = "/dashboard-v2.html";
      return env.ASSETS.fetch(new Request(assetUrl.toString(), request));
    }

    if (request.method === "POST" && url.pathname === "/run") {
      const deny = adminAuthDenied(request, env);
      if (deny) return deny;
      try {
        const dispatcherId = env.PIPELINE_DISPATCHER.idFromName("global");
        const dispatcher = env.PIPELINE_DISPATCHER.get(dispatcherId);
        const res = await dispatcher.fetch(
          new Request("https://pipeline-dispatcher/poke", {
            method: "POST",
            headers: { "content-type": "application/json; charset=utf-8" },
            body: JSON.stringify({ reason: "manual_run" }),
          }),
        );
        const result = await res.json();
        return new Response(JSON.stringify(result), {
          headers: { "content-type": "application/json" },
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        await log.critical(
          env,
          "orchestrator",
          "POST /run coordinator start failed",
          { error: msg.slice(0, 500) },
          {
            category: "orchestration",
            eventType: "manual_run_coordinator_failed",
            phase: "POST /run",
            statusKind: "failed",
          },
        );
        return new Response(JSON.stringify({ ok: false, error: msg.slice(0, 500) }), {
          status: 502,
          headers: { "content-type": "application/json" },
        });
      }
    }

    if (request.method === "POST" && url.pathname === "/admin/clear-exhaust-pause") {
      const deny = adminAuthDenied(request, env);
      if (deny) return deny;
      try {
        const result = await clearExhaustPause(env, BOOTSTRAP_ADMIN_ID);
        return new Response(JSON.stringify(result), {
          headers: { "content-type": "application/json; charset=utf-8" },
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return new Response(JSON.stringify({ ok: false, error: msg.slice(0, 500) }), {
          status: 502,
          headers: { "content-type": "application/json; charset=utf-8" },
        });
      }
    }

    if (request.method === "POST" && url.pathname === "/test-email") {
      const deny = adminAuthDenied(request, env);
      if (deny) return deny;
      const result = await sendCloudflareEmailTest(env);
      return new Response(JSON.stringify(result), {
        status: result.ok ? 200 : 502,
        headers: { "content-type": "application/json" },
      });
    }

    if (request.method === "POST" && url.pathname === "/test-jsearch") {
      const deny = adminAuthDenied(request, env);
      if (deny) return deny;
      let query = env.JSEARCH_QUERY?.trim() || "remote customer success";
      let page = 1;
      let jOverrides: JsearchDiagnosticsOverrides | undefined;
      try {
        const raw = await request.text();
        if (raw.trim()) {
          const parsed = JSON.parse(raw) as {
            query?: string;
            page?: number;
            country?: string;
            employment_types?: string;
            date_posted?: string;
          };
          if (typeof parsed.query === "string" && parsed.query.trim()) query = parsed.query.trim();
          if (typeof parsed.page === "number" && parsed.page >= 1) page = Math.floor(parsed.page);
          if (
            typeof parsed.country === "string" ||
            typeof parsed.employment_types === "string" ||
            typeof parsed.date_posted === "string"
          ) {
            jOverrides = {
              country: typeof parsed.country === "string" ? parsed.country : undefined,
              employment_types:
                typeof parsed.employment_types === "string" ? parsed.employment_types : undefined,
              date_posted: typeof parsed.date_posted === "string" ? parsed.date_posted : undefined,
            };
          }
        }
      } catch {
        return new Response(JSON.stringify({ ok: false, error: "Invalid JSON body" }), {
          status: 400,
          headers: { "content-type": "application/json" },
        });
      }
      const result = await fetchJsearchDiagnostics(env, BOOTSTRAP_ADMIN_ID, query, page, jOverrides);
      const status = result.error ? 500 : result.ok ? 200 : 502;
      return new Response(JSON.stringify(result, null, 2), {
        status,
        headers: { "content-type": "application/json; charset=utf-8" },
      });
    }

    if (request.method === "GET" && url.pathname === "/review") {
      return handleReviewGet(env, url);
    }

    if (request.method === "GET" && url.pathname === "/review/edit") {
      return handleEditGet(env, url);
    }

    if (request.method === "POST" && url.pathname === "/review/action") {
      return handleReviewAction(env, request);
    }

    if (request.method === "POST" && url.pathname === "/review/save") {
      return handleReviewSave(env, request);
    }

    return new Response("not found", { status: 404 });
  },

  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      (async () => {
        try {
          const dispatcherId = env.PIPELINE_DISPATCHER.idFromName("global");
          const dispatcher = env.PIPELINE_DISPATCHER.get(dispatcherId);
          const res = await dispatcher.fetch(
            new Request("https://pipeline-dispatcher/poke", {
              method: "POST",
              headers: { "content-type": "application/json; charset=utf-8" },
              body: JSON.stringify({ reason: "scheduled" }),
            }),
          );
          const r = (await res.json()) as { ok: boolean; dispatched: number; errors: unknown[] };
          await log.info(env, "cron", "Scheduled dispatcher poke", r);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          await log.critical(
            env,
            "cron",
            "Scheduled dispatcher poke failed",
            { error: msg.slice(0, 500) },
            {
              category: "orchestration",
              eventType: "scheduled_coordinator_failed",
              phase: "scheduled",
              statusKind: "failed",
            },
          );
        }
        try {
          const now = Math.floor(Date.now() / 1000);
          const p = await purgeExpiredDashboardJobs(env, now);
          await log.info(env, "cron", "Dashboard retention", p);
        } catch (e) {
          await log.low(
            env,
            "cron",
            "Retention failed",
            {
              err: e instanceof Error ? e.message : String(e),
            },
            {
              category: "system",
              eventType: "dashboard_retention_failed",
              phase: "scheduled",
              statusKind: "degraded",
            },
          );
        }
        try {
          // Converge the salary-EUR cache for any rows the ingest path hasn't touched yet
          // (e.g. rows that existed before the cache column was introduced). 2000/day is
          // enough to cover the full 8k-row corpus in a few days without hammering FX.
          const missingBefore = await countJobsMissingSalaryEurCache(env.DB);
          if (missingBefore > 0) {
            const fx = await fetchUsdGbpToEurRates();
            const now = Math.floor(Date.now() / 1000);
            const r = await backfillSalaryEurCacheBatch(env.DB, fx, now, 2000);
            await log.info(env, "cron", "Salary EUR cache backfill", {
              missingBefore,
              inspected: r.inspected,
              written: r.written,
            });
          }
        } catch (e) {
          await log.low(
            env,
            "cron",
            "Salary EUR cache backfill failed",
            { err: e instanceof Error ? e.message : String(e) },
            {
              category: "system",
              eventType: "salary_eur_cache_backfill_failed",
              phase: "scheduled",
              statusKind: "degraded",
            },
          );
        }
        // Daily expiration scan — check board items for expired listings and
        // hard-delete any that have been in the Expired column for ≥ 3 days.
        try {
          const nowScan = Math.floor(Date.now() / 1000);
          // ensureFresh clears day-long flags and refreshes the session if needed.
          await ensureFresh(env);
          await runDailyExpirationScan(env, nowScan);
          // Purge expired-column items older than 3 days (hard-delete the jobs)
          const userIds = await listActiveUserIds(env.DB);
          for (const uid of userIds) {
            const purged = await purgeExpiredBoardItemsHardDelete(env, uid, nowScan);
            if (purged.deletedJobs > 0) {
              await log.info(env, "cron", "Purged expired board items", { userId: uid, ...purged });
            }
          }
        } catch (e) {
          await log.critical(
            env,
            "cron",
            "Daily expiration scan failed",
            { err: e instanceof Error ? e.message : String(e) },
            {
              category: "system",
              eventType: "expiration_scan_failed",
              phase: "scheduled",
              statusKind: "failed",
            },
          );
        }
      })(),
    );
  },

  async queue(batch: MessageBatch<import("./orchestration/types").PipelineQueueMessage>, env: Env): Promise<void> {
    await handlePipelineQueue(batch, env);
  },
};

export { PipelineCoordinator, PipelineDispatcher };

async function handleReviewGet(env: Env, url: URL): Promise<Response> {
  const secret = env.REVIEW_TOKEN_SECRET;
  if (!secret) return new Response("not configured", { status: 503 });

  const token = url.searchParams.get("t") || "";
  const payload = await verifyReviewToken(secret, token);
  if (!payload) return new Response("invalid or expired link", { status: 400 });

  const row = await getJobFull(env.DB, BOOTSTRAP_ADMIN_ID, payload.jobId);
  if (!row) return new Response("job not found", { status: 404 });

  const positives = safeJsonArray(row.reasons_to_apply);
  const negatives = safeJsonArray(row.risks);

  const priorityLabel = fitPriorityLabel(String(row.recommendation ?? ""));

  const html = reviewPageHtml({
    jobTitle: String(row.title ?? ""),
    company: String(row.company ?? ""),
    applyUrl: String(row.apply_url ?? row.job_url ?? ""),
    fitScore: Number(row.fit_score ?? 0),
    priorityLabel,
    positives,
    negatives,
    cvDraft: String(row.draft_cv ?? ""),
    coverLetter: String(row.draft_cover_letter ?? ""),
    token,
  });

  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
}

async function handleEditGet(env: Env, url: URL): Promise<Response> {
  const secret = env.REVIEW_TOKEN_SECRET;
  if (!secret) return new Response("not configured", { status: 503 });

  const token = url.searchParams.get("t") || "";
  const payload = await verifyReviewToken(secret, token);
  if (!payload) return new Response("invalid or expired link", { status: 400 });

  const row = await getJobFull(env.DB, BOOTSTRAP_ADMIN_ID, payload.jobId);
  if (!row) return new Response("job not found", { status: 404 });

  const html = editPageHtml({
    cvDraft: String(row.draft_cv ?? ""),
    coverLetter: String(row.draft_cover_letter ?? ""),
    token,
  });

  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
}

async function handleReviewAction(env: Env, request: Request): Promise<Response> {
  const secret = env.REVIEW_TOKEN_SECRET;
  if (!secret) return new Response("not configured", { status: 503 });

  const form = await request.formData();
  const token = String(form.get("t") || "");
  const action = String(form.get("action") || "");

  const payload = await verifyReviewToken(secret, token);
  if (!payload) return new Response("invalid or expired link", { status: 400 });

  const now = Math.floor(Date.now() / 1000);
  if (action === "approve") {
    await setJobStatus(env.DB, BOOTSTRAP_ADMIN_ID, payload.jobId, "approved", now);
  } else if (action === "reject") {
    await setJobStatus(env.DB, BOOTSTRAP_ADMIN_ID, payload.jobId, "rejected", now);
  } else {
    return new Response("bad action", { status: 400 });
  }

  return new Response(`Status saved: ${action}. You can close this tab.`, {
    status: 200,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

async function handleReviewSave(env: Env, request: Request): Promise<Response> {
  const secret = env.REVIEW_TOKEN_SECRET;
  if (!secret) return new Response("not configured", { status: 503 });

  const form = await request.formData();
  const token = String(form.get("t") || "");
  const cv = String(form.get("cv") || "");
  const cover = String(form.get("cover") || "");

  const payload = await verifyReviewToken(secret, token);
  if (!payload) return new Response("invalid or expired link", { status: 400 });

  const now = Math.floor(Date.now() / 1000);
  await updateDrafts(env.DB, BOOTSTRAP_ADMIN_ID, payload.jobId, cv, cover, now);

  return Response.redirect(new URL(`/review?t=${encodeURIComponent(token)}`, request.url).toString(), 302);
}

function adminAuthDenied(request: Request, env: Env): Response | null {
  const admin = env.ADMIN_RUN_KEY;
  if (!admin) return null;
  const auth = request.headers.get("Authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (token !== admin) {
    return new Response("unauthorized", { status: 401 });
  }
  return null;
}

function safeJsonArray(v: unknown): string[] {
  if (typeof v !== "string") return [];
  try {
    const x = JSON.parse(v) as unknown;
    return Array.isArray(x) ? x.filter((i): i is string => typeof i === "string") : [];
  } catch {
    return [];
  }
}
