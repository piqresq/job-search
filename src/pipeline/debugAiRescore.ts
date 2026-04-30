import { getJob, loadNormalizedJob, loadScoringResult } from "../db/jobs";
import { log } from "../logging/appLog";
import { stableJobId } from "./ids";
import { processFetchedJobs } from "./runPipeline";
import type { NormalizedJob, ScoringResult } from "../types/job";

export type DebugAiRescoreResult =
  | { ok: true; scoring: ScoringResult; newJobId: string; parentJobId: string; pipelineWarnings?: string[] }
  | {
      ok: false;
      error: string;
      code: "not_found" | "openai_not_configured" | "openai_failed" | "pipeline_failed";
    };

export type RetryFailedJobResult =
  | {
      ok: true;
      jobId: string;
      status: string;
      dashBucket: string;
      fitScore: number | null;
      recommendation: string;
      retryOutcome: "active" | "filtered" | "failed";
      pipelineWarnings?: string[];
    }
  | {
      ok: false;
      error: string;
      code: "not_found" | "not_failed";
    };

const MAX_EXTERNAL_ID_LEN = 3500;

/**
 * Creates a **new** `jobs` row (new `external_id` → new stable id) with the same normalized payload as the
 * parent, then runs {@link processFetchedJobs} like an API ingest with synthetic bypass (no hard-filter reject,
 * no content-hash duplicate reject). Parent row is unchanged.
 */
export async function rescoreJobBypassingHardFilters(env: Env, parentJobId: string): Promise<DebugAiRescoreResult> {
  const job = await loadNormalizedJob(env.DB, parentJobId);
  if (!job) {
    return { ok: false, error: "Job not found or missing normalized_json", code: "not_found" };
  }

  const now = Math.floor(Date.now() / 1000);
  const rand = crypto.randomUUID().replace(/-/g, "").slice(0, 12);
  const tail = `__job_search_debug__${now}_${rand}`;
  const maxBase = Math.max(1, MAX_EXTERNAL_ID_LEN - tail.length);
  const newExternalId = job.externalId.slice(0, maxBase) + tail;

  const cloned: NormalizedJob = {
    ...job,
    externalId: newExternalId,
    apiFetchedAtUnix: now,
    raw: {
      ...(typeof job.raw === "object" && job.raw !== null ? job.raw : {}),
      _jobSearchDebugCloneOf: parentJobId,
    },
  };

  const newJobId = await stableJobId(cloned.source, cloned.externalId);

  await log.info(env, "dashboard", "debug_ai_rescore: ingesting clone", {
    parentJobId,
    newJobId,
    source: cloned.source,
    externalIdSuffix: tail,
  });

  const summary = await processFetchedJobs(env, [cloned], {
    debugSyntheticIngestJobIds: new Set([newJobId]),
  });

  const row = await getJob(env.DB, newJobId);
  if (row?.status === "hard_rejected") {
    return {
      ok: false,
      error:
        summary.errors.join("; ").slice(0, 800) ||
        "Clone remained hard_rejected after pipeline run.",
      code: "pipeline_failed",
    };
  }

  if (summary.processed === 0) {
    const openaiLine = summary.errors.find((e) => e.startsWith(`openai ${newJobId}:`));
    if (openaiLine?.includes("missing OPENAI_API_KEY")) {
      return { ok: false, error: openaiLine, code: "openai_not_configured" };
    }
    if (openaiLine) {
      const tailErr = openaiLine.includes(":") ? openaiLine.slice(openaiLine.indexOf(":") + 1).trim() : openaiLine;
      return { ok: false, error: tailErr.slice(0, 800), code: "openai_failed" };
    }
    return {
      ok: false,
      error: summary.errors.join("; ").slice(0, 800) || "Pipeline did not complete scoring for the clone.",
      code: "pipeline_failed",
    };
  }

  const scoring = await loadScoringResult(env.DB, newJobId);
  if (!scoring) {
    return {
      ok: false,
      error: summary.errors.join("; ").slice(0, 800) || "Missing scoring_json after pipeline run.",
      code: "pipeline_failed",
    };
  }

  return {
    ok: true,
    scoring,
    newJobId,
    parentJobId,
    pipelineWarnings: summary.errors.length ? summary.errors : undefined,
  };
}

/**
 * Re-runs the original row through the normal pipeline (hard filters + AI scoring) after a failed
 * partial ingest. Success moves the row to its normal bucket; another failure leaves it as `failed`
 * in the Filtered tab with an updated explanation.
 */
export async function retryFailedJobProcessing(env: Env, jobId: string): Promise<RetryFailedJobResult> {
  const before = await getJob(env.DB, jobId);
  if (!before) {
    return { ok: false, error: "Job not found.", code: "not_found" };
  }
  if (before.status !== "failed") {
    return { ok: false, error: "Only failed rows can be retried.", code: "not_failed" };
  }

  const job = await loadNormalizedJob(env.DB, jobId);
  if (!job) {
    return { ok: false, error: "Job not found or missing normalized_json.", code: "not_found" };
  }

  await log.info(env, "dashboard", "retry_failed_job: reprocessing row", {
    jobId,
    source: job.source,
    title: job.title,
    company: job.company,
  });

  const summary = await processFetchedJobs(env, [job]);
  const after = await getJob(env.DB, jobId);
  if (!after) {
    return { ok: false, error: "Job disappeared during retry.", code: "not_found" };
  }

  const retryOutcome =
    after.status === "failed"
      ? "failed"
      : after.dash_bucket === "active"
        ? "active"
        : "filtered";

  return {
    ok: true,
    jobId,
    status: after.status,
    dashBucket: after.dash_bucket ?? "",
    fitScore: after.fit_score ?? null,
    recommendation: after.recommendation ?? "",
    retryOutcome,
    pipelineWarnings: summary.errors.length ? summary.errors : undefined,
  };
}
