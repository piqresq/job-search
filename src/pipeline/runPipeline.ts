import {
  getPipelineFetchAllowed,
  incrementOpenAiNetworkFailureStreak,
  isExtractionActive,
  resetOpenAiNetworkFailureStreak,
  setApiExtractionEnabled,
} from "../db/appSettings";
import {
  applyStatisticsDeltas,
  type StatisticsCounterDelta,
  type StatisticsDelta,
  type StatisticsVariantDimension,
} from "../db/statistics";
import {
  findOtherJobIdWithContentDedupeHash,
  getJob,
  listContentDedupeCandidateJobsByCompanyTitle,
  markDashboardProcessingFailure,
  markHardPassed,
  markHardRejected,
  saveScoring,
  updateNormalizedJobNormalizedJson,
  updateNormalizedJobSalary,
  upsertNormalizedJob,
} from "../db/jobs";
import { log, observabilityLog } from "../logging/appLog";
import { getEnabledProviders } from "../providers";
import {
  computeContentDedupeHash,
  computeCountryInclusiveContentDedupeHash,
  duplicateListingHardRejectReasons,
  isContentDedupeAnchorJob,
} from "./contentDedupeHash";
import { dedupeJobs } from "./dedupe";
import { applyHardFilters, fetchUsdGbpToEurRates, getSalaryBelowFloorReasons } from "./hardFilters";
import { stableJobId } from "./ids";
import { assignWorkplaceTypeToJob } from "../providers/lib/workplaceTypeCanonical";
import { mergeSalaryFromScoring, mergeWorkplaceTypeFromScoring } from "./mergeAiSalary";
import {
  isOpenAiNetworkOutageStyleFailure,
  isOpenAiQuotaExhaustedError,
  isOpenAiSystemicConfigurationError,
} from "./openaiTransientErrors";
import { scoreJobWithOpenAI } from "./openaiScore";
import {
  getVendorTitleHealthOptions,
  resolveCanonicalSearchRoleForHealth,
  scoreTitleToQueryHealth,
} from "../metrics/titleQueryHealth";
import { normalizeRejectionReason, type NormalizedJob, type ScoringResult } from "../types/job";
import {
  checkListingActiveAtIngest,
  INGEST_EXPIRED_REASON,
} from "./ingestActiveCheck";

/** Email + tokenized review flow is soft-disabled; use /dashboard instead. */

type ContentDedupeMatchPath = "exact_hash" | "remote_countryless_fingerprint";

function statisticsVariantFromJob(job: NormalizedJob): StatisticsVariantDimension | null {
  const searchQuery = typeof job.searchQuery === "string" ? job.searchQuery.trim() : "";
  if (!searchQuery) return null;
  return {
    searchQuery,
    tier: 1,
    countryKey: job.searchCountryKey,
    countryLabel: job.searchCountryLabel ?? job.country,
  };
}

function statisticsOutcomeDeltaForFinalScoring(scoring: ScoringResult): StatisticsCounterDelta {
  if (scoring.recommendation === "high_priority_review") {
    return { jobsProcessed: 1, jobsHigh: 1 };
  }
  if (scoring.recommendation === "review") {
    return { jobsProcessed: 1, jobsMedium: 1 };
  }
  if (scoring.recommendation === "low_priority_review") {
    return { jobsProcessed: 1, jobsLow: 1 };
  }
  return {
    jobsProcessed: 1,
    jobsFiltered: 1,
    jobsAiRejected: 1,
  };
}

function shouldSkipExisting(row: {
  status: string;
  dash_bucket: string | null;
}): boolean {
  if (row.dash_bucket === "accepted" || row.dash_bucket === "denied") return true;
  return (
    row.status === "hard_rejected" ||
    row.status === "rejected_by_ai" ||
    row.status === "review_email_sent" ||
    row.status === "approved" ||
    row.status === "rejected" ||
    row.status === "edit_pending" ||
    row.status === "dashboard_open"
  );
}

async function findRemoteDuplicateByCurrentContentFingerprint(
  db: D1Database,
  userId: string,
  job: NormalizedJob,
  excludeId: string,
  excludeCreatedAtUnix: number,
): Promise<string | null> {
  if (job.workplaceType !== "Remote") return null;

  const candidates = await listContentDedupeCandidateJobsByCompanyTitle(
    db,
    userId,
    job.company,
    job.title,
    excludeId,
    excludeCreatedAtUnix,
  );
  for (const candidate of candidates) {
    if (candidate.created_at > excludeCreatedAtUnix) continue;
    if (candidate.created_at === excludeCreatedAtUnix && candidate.id >= excludeId) continue;
    if (!isContentDedupeAnchorJob(candidate)) continue;
    if (!candidate.content_dedupe_hash || !candidate.normalized_json) continue;
    try {
      const normalized = JSON.parse(candidate.normalized_json) as NormalizedJob;
      const candidateCountry = normalized.country || normalized.searchCountryLabel || "";
      const legacyHashForCandidateCountry = await computeCountryInclusiveContentDedupeHash({
        ...job,
        country: candidateCountry,
        searchCountryLabel: candidateCountry,
      });
      if (legacyHashForCandidateCountry && legacyHashForCandidateCountry === candidate.content_dedupe_hash) {
        return candidate.id;
      }
    } catch {
      continue;
    }
  }
  return null;
}

const PIPELINE_STATE_WRITE_MAX_ATTEMPTS = 3;
const PIPELINE_STATE_WRITE_BASE_BACKOFF_MS = 150;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function retryPipelineStateWrite<T>(
  env: Env,
  args: {
    jobId: string;
    providerId: NormalizedJob["source"];
    phase: string;
    action: string;
    run: () => Promise<T>;
  },
): Promise<T> {
  let lastErr: unknown = null;
  for (let attempt = 1; attempt <= PIPELINE_STATE_WRITE_MAX_ATTEMPTS; attempt++) {
    try {
      return await args.run();
    } catch (e) {
      lastErr = e;
      if (attempt >= PIPELINE_STATE_WRITE_MAX_ATTEMPTS) break;
      const msg = e instanceof Error ? e.message : String(e);
      observabilityLog(
        "warn",
        "pipeline",
        "Retrying pipeline state write after failure",
        {
          jobId: args.jobId,
          providerId: args.providerId,
          phase: args.phase,
          action: args.action,
          attemptNumber: attempt,
          maxAttempts: PIPELINE_STATE_WRITE_MAX_ATTEMPTS,
          error: msg.slice(0, 500),
        },
        {
          category: "storage",
          eventType: "pipeline_state_write_retry_scheduled",
          providerId: args.providerId,
          jobId: args.jobId,
          phase: args.phase,
          statusKind: "degraded",
        },
      );
      await delay(PIPELINE_STATE_WRITE_BASE_BACKOFF_MS * 2 ** (attempt - 1));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

async function markVisibleProcessingFailure(
  env: Env,
  userId: string,
  id: string,
  providerId: NormalizedJob["source"],
  reason: string,
  now: number,
  errors: string[],
): Promise<void> {
  try {
    await retryPipelineStateWrite(env, {
      jobId: id,
      providerId,
      phase: "processFetchedJobs",
      action: "markDashboardProcessingFailure",
      run: () => markDashboardProcessingFailure(env.DB, userId, id, reason, now),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    errors.push(`dashboard_processing_failure ${id}: ${msg}`);
    await log.moderate(
      env,
      "pipeline",
      "Persist dashboard processing-failure state failed",
      {
        jobId: id,
        reason: reason.slice(0, 500),
        error: msg.slice(0, 500),
      },
      {
        category: "storage",
        eventType: "dashboard_processing_failure_persist_failed",
        jobId: id,
        phase: "processFetchedJobs",
        statusKind: "degraded",
      },
    );
  }
}

export type ProcessFetchedJobsSummary = {
  fetched: number;
  processed: number;
  skipped: number;
  errors: string[];
};

/** Optional behavior for {@link processFetchedJobs} (e.g. dashboard AI debug clone ingest). */
export type ProcessFetchedJobsOptions = {
  /**
   * Stable job ids (`jobs.id`) for **synthetic** rows (new `external_id`, new id): same ingest path as API
   * except (1) {@link shouldSkipExisting} is ignored, (2) content-hash duplicate of an older row does not
   * hard-reject, (3) {@link applyHardFilters} failure does not hard-reject.
   */
  debugSyntheticIngestJobIds?: ReadonlySet<string>;
  /** Optional chunk-progress hook for orchestration heartbeats / trace logging. */
  onJobStart?: (info: { index: number; total: number; job: NormalizedJob }) => Promise<void> | void;
};

export async function processFetchedJobs(
  env: Env,
  userId: string,
  jobs: NormalizedJob[],
  opts?: ProcessFetchedJobsOptions,
): Promise<ProcessFetchedJobsSummary> {
  const deduped = dedupeJobs(jobs);
  const errors: string[] = [];
  const statisticsDeltas: StatisticsDelta[] = [];
  const now = Math.floor(Date.now() / 1000);
  let processed = 0;
  let skipped = 0;
  const fx = await fetchUsdGbpToEurRates();

  for (let index = 0; index < deduped.length; index++) {
    const job = deduped[index]!;
    await opts?.onJobStart?.({
      index: index + 1,
      total: deduped.length,
      job,
    });
    let id: string;
    let existing: Awaited<ReturnType<typeof getJob>>;
    try {
      id = await stableJobId(job.source, job.externalId);
      existing = await getJob(env.DB, userId, id);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(`job_lookup ${job.source}:${job.externalId}: ${msg}`);
      await log.moderate(
        env,
        "pipeline",
        "Job lookup failed",
        {
          providerId: job.source,
          externalId: job.externalId,
          error: msg.slice(0, 500),
        },
        {
          category: "storage",
          eventType: "job_lookup_failed",
          providerId: job.source,
          phase: "processFetchedJobs",
          statusKind: "degraded",
        },
      );
      continue;
    }

    const debugSynthetic = opts?.debugSyntheticIngestJobIds?.has(id) ?? false;

    if (existing && shouldSkipExisting(existing) && !debugSynthetic) {
      skipped++;
      observabilityLog(
        "debug",
        "pipeline",
        "Skipped existing terminal job",
        {
          jobId: id,
          providerId: job.source,
          externalId: job.externalId,
          status: existing.status,
          dashboardBucket: existing.dash_bucket,
        },
        {
          category: "system",
          eventType: "process_fetched_job_skipped_existing",
          providerId: job.source,
          jobId: id,
          phase: "processFetchedJobs",
          statusKind: "ok",
        },
      );
      continue;
    }

    let jobWithFetchMeta: NormalizedJob = assignWorkplaceTypeToJob({ ...job, apiFetchedAtUnix: now });
    const canonicalRole = resolveCanonicalSearchRoleForHealth(jobWithFetchMeta);
    const vendorHealthOpts = getVendorTitleHealthOptions(jobWithFetchMeta.source);
    if (canonicalRole.length > 0 && (jobWithFetchMeta.title ?? "").trim().length > 0) {
      const health = scoreTitleToQueryHealth(canonicalRole, jobWithFetchMeta.title ?? "", vendorHealthOpts);
      jobWithFetchMeta = {
        ...jobWithFetchMeta,
        titleQueryHealthScore: health.score,
        titleQueryHealthBand: health.band,
      };
    }
    let contentDedupeHash: string | null = null;
    try {
      contentDedupeHash = await computeContentDedupeHash(jobWithFetchMeta);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(`content_dedupe_hash ${id}: ${msg}`);
      await log.moderate(
        env,
        "pipeline",
        "Content dedupe fingerprint hash failed",
        {
          jobId: id,
          providerId: job.source,
          error: msg.slice(0, 500),
        },
        {
          category: "storage",
          eventType: "content_dedupe_hash_compute_failed",
          providerId: job.source,
          jobId: id,
          phase: "content_hash_dedupe",
          statusKind: "degraded",
        },
      );
    }
    try {
      await retryPipelineStateWrite(env, {
        jobId: id,
        providerId: job.source,
        phase: "processFetchedJobs",
        action: "upsertNormalizedJob",
        run: () => upsertNormalizedJob(env.DB, userId, id, jobWithFetchMeta, now, contentDedupeHash, fx),
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(`upsert ${id}: ${msg}`);
      await log.moderate(
        env,
        "pipeline",
        "Persist normalized job failed",
        {
          jobId: id,
          providerId: job.source,
          error: msg.slice(0, 500),
        },
        {
          category: "storage",
          eventType: "normalized_job_upsert_failed",
          providerId: job.source,
          jobId: id,
          phase: "processFetchedJobs",
          statusKind: "degraded",
        },
      );
      if (existing) {
        await markVisibleProcessingFailure(
      env,
      userId,
      id,
          job.source,
          `Pipeline failed while refreshing the stored job row before scoring: ${msg.slice(0, 500)}`,
          now,
          errors,
        );
      }
      continue;
    }

    if (contentDedupeHash) {
      const excludeCreatedAt = existing?.created_at ?? now;
      let dupOf: string | null = null;
      let dedupeMatchPath: ContentDedupeMatchPath | null = null;
      try {
        dupOf = await findOtherJobIdWithContentDedupeHash(
          env.DB,
          userId,
          contentDedupeHash,
          id,
          excludeCreatedAt,
        );
        if (dupOf) dedupeMatchPath = "exact_hash";
        if (!dupOf) {
          dupOf = await findRemoteDuplicateByCurrentContentFingerprint(
            env.DB,
            userId,
            jobWithFetchMeta,
            id,
            excludeCreatedAt,
          );
          if (dupOf) dedupeMatchPath = "remote_countryless_fingerprint";
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        errors.push(`content_dedupe_lookup ${id}: ${msg}`);
        await log.moderate(
          env,
          "pipeline",
          "Content dedupe D1 lookup failed (duplicate check skipped for this job)",
          {
            jobId: id,
            providerId: job.source,
            error: msg.slice(0, 500),
          },
          {
            category: "storage",
            eventType: "content_dedupe_lookup_failed",
            providerId: job.source,
            jobId: id,
            phase: "content_hash_dedupe",
            statusKind: "degraded",
          },
        );
      }
      if (dupOf) {
        await log.event(env, {
          level: "info",
          scope: "pipeline",
          message: "Content dedupe duplicate detected",
          meta: {
            jobId: id,
            duplicateOf: dupOf,
            providerId: job.source,
            contentDedupeHashPrefix: contentDedupeHash.slice(0, 8),
            dedupeMatchPath,
            duplicateRule:
              dedupeMatchPath === "remote_countryless_fingerprint"
                ? "remote listing matched current countryless fingerprint against older stored job JSON"
                : "stored content_dedupe_hash matched",
            title: jobWithFetchMeta.title,
            company: jobWithFetchMeta.company,
            workplaceType: jobWithFetchMeta.workplaceType,
            country: jobWithFetchMeta.country ?? null,
            searchCountryLabel: jobWithFetchMeta.searchCountryLabel ?? null,
          },
          context: {
            severity: "none",
            category: "system",
            eventType: "content_dedupe_duplicate_detected",
            providerId: job.source,
            jobId: id,
            phase: "content_hash_dedupe",
            fingerprint: `content_dedupe_duplicate|${dedupeMatchPath ?? "unknown"}|${job.source}`,
            statusKind: "ok",
          },
        });
      }
      if (dupOf && debugSynthetic) {
        await log.low(
          env,
          "pipeline",
          "Synthetic ingest: skipping content-hash duplicate reject (debug clone)",
          { jobId: id, duplicateOf: dupOf },
          {
            category: "dashboard",
            eventType: "debug_clone_skipped_content_dedupe",
            jobId: id,
            phase: "processFetchedJobs",
            statusKind: "ok",
          },
        );
      }
      if (dupOf && !debugSynthetic) {
        try {
          await retryPipelineStateWrite(env, {
            jobId: id,
            providerId: job.source,
            phase: "content_hash_dedupe",
            action: "markHardRejectedDuplicate",
            run: () =>
              markHardRejected(env.DB, userId, id, duplicateListingHardRejectReasons(dupOf, contentDedupeHash), now),
          });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          errors.push(`hard_reject ${id}: ${msg}`);
          await log.moderate(
            env,
            "pipeline",
            "Persist hard reject failed (content-hash dedupe)",
            {
              jobId: id,
              providerId: job.source,
              canonicalJobId: dupOf,
              error: msg.slice(0, 500),
            },
            {
              category: "storage",
              eventType: "content_hash_dedupe_persist_failed",
              providerId: job.source,
              jobId: id,
              phase: "content_hash_dedupe",
              statusKind: "degraded",
            },
          );
          await markVisibleProcessingFailure(
      env,
      userId,
      id,
            job.source,
            `Pipeline failed while saving the duplicate-listing filter result: ${msg.slice(0, 500)}`,
            now,
            errors,
          );
          continue;
        }
        statisticsDeltas.push({
          userId,
          providerId: job.source,
          atUnix: jobWithFetchMeta.apiFetchedAtUnix ?? now,
          jobsProcessed: 1,
          jobsFiltered: 1,
          jobsHardRejected: 1,
          variant: statisticsVariantFromJob(jobWithFetchMeta),
        });
        observabilityLog(
          "debug",
          "pipeline",
          "Rejected duplicate listing by content fingerprint",
          {
            jobId: id,
            providerId: job.source,
            duplicateOf: dupOf,
            contentDedupeHashPrefix: contentDedupeHash.slice(0, 8),
            dedupeMatchPath,
          },
          {
            category: "system",
            eventType: "process_fetched_job_duplicate_rejected",
            providerId: job.source,
            jobId: id,
            phase: "content_hash_dedupe",
            statusKind: "ok",
          },
        );
        processed++;
        continue;
      }
    }

    const hf = applyHardFilters(jobWithFetchMeta, fx);
    if (!hf.pass && !debugSynthetic) {
      try {
        await retryPipelineStateWrite(env, {
          jobId: id,
          providerId: job.source,
          phase: "hard_filters",
          action: "markHardRejected",
          run: () => markHardRejected(env.DB, userId, id, hf.reasons, now),
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        errors.push(`hard_reject ${id}: ${msg}`);
        await log.moderate(
          env,
          "pipeline",
          "Persist hard reject failed",
          {
            jobId: id,
            providerId: job.source,
            error: msg.slice(0, 500),
          },
          {
            category: "storage",
            eventType: "hard_reject_persist_failed",
            providerId: job.source,
            jobId: id,
            phase: "hard_filters",
            statusKind: "degraded",
          },
        );
        await markVisibleProcessingFailure(
      env,
      userId,
      id,
          job.source,
          `Pipeline failed while saving the hard-filter result: ${msg.slice(0, 500)}`,
          now,
          errors,
        );
        continue;
      }
      statisticsDeltas.push({
        userId,
        providerId: job.source,
        atUnix: jobWithFetchMeta.apiFetchedAtUnix ?? now,
        jobsProcessed: 1,
        jobsFiltered: 1,
        jobsHardRejected: 1,
        variant: statisticsVariantFromJob(jobWithFetchMeta),
      });
      observabilityLog(
        "debug",
        "pipeline",
        "Rejected job by hard filters",
        {
          jobId: id,
          providerId: job.source,
          reasons: hf.reasons.slice(0, 5),
        },
        {
          category: "system",
          eventType: "process_fetched_job_hard_rejected",
          providerId: job.source,
          jobId: id,
          phase: "hard_filters",
          statusKind: "ok",
        },
      );
      processed++;
      continue;
    }

    try {
      await retryPipelineStateWrite(env, {
        jobId: id,
        providerId: job.source,
        phase: "hard_filters",
        action: "markHardPassed",
        run: () => markHardPassed(env.DB, userId, id, now),
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(`hard_pass ${id}: ${msg}`);
      await log.moderate(
        env,
        "pipeline",
        "Persist hard-pass status failed",
        {
          jobId: id,
          providerId: job.source,
          error: msg.slice(0, 500),
        },
        {
          category: "storage",
          eventType: "hard_pass_persist_failed",
          providerId: job.source,
          jobId: id,
          phase: "hard_filters",
          statusKind: "degraded",
        },
      );
      await markVisibleProcessingFailure(
      env,
      userId,
      id,
        job.source,
        `Pipeline failed while recording that hard filters passed: ${msg.slice(0, 500)}`,
        now,
        errors,
      );
      continue;
    }

    let scoring: ScoringResult | null;
    try {
      scoring = await scoreJobWithOpenAI(env.DB, env, userId, jobWithFetchMeta);
      await resetOpenAiNetworkFailureStreak(env.DB, userId);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(`openai ${id}: ${msg}`);
      observabilityLog(
        "error",
        "openai",
        "Job scoring failed during pipeline processing",
        {
          jobId: id,
          providerId: job.source,
          error: msg.slice(0, 500),
        },
        {
          category: "ai_scoring",
          eventType: "process_fetched_job_scoring_failed",
          providerId: job.source,
          jobId: id,
          phase: "scoreJobWithOpenAI",
          statusKind: "degraded",
        },
      );
      await log.moderate(
        env,
        "openai",
        "Job scoring failed",
        { jobId: id, providerId: job.source, error: msg.slice(0, 500) },
        {
          category: "ai_scoring",
          eventType: "job_scoring_failed",
          providerId: job.source,
          jobId: id,
          phase: "scoreJobWithOpenAI",
          statusKind: "degraded",
        },
      );
      if (isOpenAiNetworkOutageStyleFailure(e)) {
        const streak = await incrementOpenAiNetworkFailureStreak(env.DB, userId);
        if (streak > 3) {
          await setApiExtractionEnabled(env.DB, userId, false);
          await log.critical(
            env,
            "openai",
            "API extraction disabled after repeated OpenAI network failures",
            {
              streak,
              lastJobId: id,
              providerId: job.source,
              lastError: msg.slice(0, 500),
            },
            {
              category: "ai_scoring",
              eventType: "openai_network_circuit_open",
              providerId: job.source,
              jobId: id,
              phase: "scoreJobWithOpenAI",
              statusKind: "failed",
              fingerprint: "openai_network_circuit_open",
            },
          );
          await resetOpenAiNetworkFailureStreak(env.DB, userId);
        }
      } else {
        // Any non-network OpenAI failure breaks the consecutive outage streak.
        await resetOpenAiNetworkFailureStreak(env.DB, userId);
        if (isOpenAiQuotaExhaustedError(e)) {
          await setApiExtractionEnabled(env.DB, userId, false);
          await log.critical(
            env,
            "openai",
            "API extraction disabled after OpenAI quota exhaustion",
            {
              jobId: id,
              providerId: job.source,
              error: msg.slice(0, 500),
            },
            {
              category: "ai_scoring",
              eventType: "openai_quota_circuit_open",
              providerId: job.source,
              jobId: id,
              phase: "scoreJobWithOpenAI",
              statusKind: "failed",
              fingerprint: "openai_quota_circuit_open",
            },
          );
        } else if (isOpenAiSystemicConfigurationError(e)) {
          await setApiExtractionEnabled(env.DB, userId, false);
          await log.critical(
            env,
            "openai",
            "API extraction disabled after non-retryable OpenAI request configuration error",
            {
              jobId: id,
              providerId: job.source,
              error: msg.slice(0, 500),
            },
            {
              category: "ai_scoring",
              eventType: "openai_config_circuit_open",
              providerId: job.source,
              jobId: id,
              phase: "scoreJobWithOpenAI",
              statusKind: "failed",
              fingerprint: "openai_config_circuit_open",
            },
          );
        }
      }
      await markVisibleProcessingFailure(
      env,
      userId,
      id,
        job.source,
        `OpenAI scoring failed before a final recommendation was stored: ${msg.slice(0, 500)}`,
        now,
        errors,
      );
      continue;
    }

    if (!scoring) {
      errors.push(`openai ${id}: missing OPENAI_API_KEY`);
      await log.moderate(
        env,
        "openai",
        "Job scoring skipped because OpenAI is not configured",
        { jobId: id, providerId: job.source },
        {
          category: "ai_scoring",
          eventType: "openai_not_configured",
          providerId: job.source,
          jobId: id,
          phase: "scoreJobWithOpenAI",
          statusKind: "degraded",
          fingerprint: "openai_not_configured",
        },
      );
      await markVisibleProcessingFailure(
      env,
      userId,
      id,
        job.source,
        "OpenAI scoring is not configured, so no final recommendation was stored.",
        now,
        errors,
      );
      continue;
    }

    let mergedJob = mergeSalaryFromScoring(jobWithFetchMeta, scoring);
    mergedJob = mergeWorkplaceTypeFromScoring(mergedJob, scoring);
    mergedJob = assignWorkplaceTypeToJob(mergedJob);

    const salaryChanged =
      mergedJob.salaryMin !== jobWithFetchMeta.salaryMin ||
      mergedJob.salaryMax !== jobWithFetchMeta.salaryMax ||
      mergedJob.salaryRaw !== jobWithFetchMeta.salaryRaw ||
      mergedJob.salaryCurrency !== jobWithFetchMeta.salaryCurrency;

    const workplacePersistedChanged =
      mergedJob.workplaceType !== jobWithFetchMeta.workplaceType ||
      mergedJob.workplaceTypeAi !== jobWithFetchMeta.workplaceTypeAi;

    if (salaryChanged) {
      try {
        await retryPipelineStateWrite(env, {
          jobId: id,
          providerId: job.source,
          phase: "merge_ai_salary",
          action: "updateNormalizedJobSalary",
          run: () => updateNormalizedJobSalary(env.DB, userId, id, mergedJob, now, fx),
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        errors.push(`salary_update ${id}: ${msg}`);
        await log.moderate(
          env,
          "pipeline",
          "Persist AI-derived salary failed",
          {
            jobId: id,
            providerId: job.source,
            error: msg.slice(0, 500),
          },
          {
            category: "storage",
            eventType: "salary_update_failed",
            providerId: job.source,
            jobId: id,
            phase: "merge_ai_salary",
            statusKind: "degraded",
          },
        );
      }
    } else if (workplacePersistedChanged) {
      try {
        await retryPipelineStateWrite(env, {
          jobId: id,
          providerId: job.source,
          phase: "merge_ai_workplace",
          action: "updateNormalizedJobNormalizedJson",
          run: () => updateNormalizedJobNormalizedJson(env.DB, userId, id, mergedJob, now),
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        errors.push(`workplace_json_update ${id}: ${msg}`);
        await log.moderate(
          env,
          "pipeline",
          "Persist AI-derived workplace on normalized_json failed",
          {
            jobId: id,
            providerId: job.source,
            error: msg.slice(0, 500),
          },
          {
            category: "storage",
            eventType: "workplace_json_update_failed",
            providerId: job.source,
            jobId: id,
            phase: "merge_ai_workplace",
            statusKind: "degraded",
          },
        );
      }
    }

    const floorReasons = getSalaryBelowFloorReasons(mergedJob, fx);
    let finalScoring: ScoringResult = scoring;
    if (floorReasons.length > 0) {
      const rr =
        scoring.recommendation === "reject" && scoring.rejection_reason.trim()
          ? `${scoring.rejection_reason.trim()}; ${floorReasons[0]}`
          : floorReasons[0];
      finalScoring = {
        ...scoring,
        recommendation: "reject",
        rejection_reason: normalizeRejectionReason(rr),
        priority_label: "",
      };
    }

    // Ingest-time active check: only for medium and high relevance jobs.
    // Fetches the live listing page once; if confidently expired, hard-rejects
    // the job before it ever becomes visible in the dashboard.
    // Any ambiguous result (blocked, transient, unclear, no session) is treated
    // as "skip" so the job passes through normally — we only reject on certainty.
    if (
      finalScoring.recommendation === "high_priority_review" ||
      finalScoring.recommendation === "review"
    ) {
      let activeCheckResult: "expired" | "skip" = "skip";
      try {
        activeCheckResult = await checkListingActiveAtIngest(env, mergedJob);
      } catch {
        // Non-fatal: any unexpected error in the check lets the job through.
      }
      if (activeCheckResult === "expired") {
        try {
          await retryPipelineStateWrite(env, {
            jobId: id,
            providerId: job.source,
            phase: "ingest_active_check",
            action: "markHardRejected",
            run: () => markHardRejected(env.DB, userId, id, [INGEST_EXPIRED_REASON], now),
          });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          errors.push(`ingest_active_check_reject ${id}: ${msg}`);
          await log.moderate(
            env,
            "pipeline",
            "Persist ingest active check reject failed",
            { jobId: id, providerId: job.source, error: msg.slice(0, 500) },
            {
              category: "storage",
              eventType: "ingest_active_check_reject_failed",
              providerId: job.source,
              jobId: id,
              phase: "ingest_active_check",
              statusKind: "degraded",
            },
          );
          continue;
        }
        await log.info(
          env,
          "pipeline",
          `Listing expired at ingest: ${jobWithFetchMeta.title} at ${jobWithFetchMeta.company}`,
          {
            jobId: id,
            providerId: job.source,
            recommendation: finalScoring.recommendation,
            company: jobWithFetchMeta.company,
            title: jobWithFetchMeta.title,
          },
        );
        statisticsDeltas.push({
          userId,
          providerId: job.source,
          atUnix: jobWithFetchMeta.apiFetchedAtUnix ?? now,
          jobsProcessed: 1,
          jobsFiltered: 1,
          jobsHardRejected: 1,
          variant: statisticsVariantFromJob(jobWithFetchMeta),
        });
        processed++;
        continue;
      }
    }

    try {
      await retryPipelineStateWrite(env, {
        jobId: id,
        providerId: job.source,
        phase: "saveScoring",
        action: "saveScoring",
        run: () => saveScoring(env.DB, userId, id, finalScoring, now),
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(`save_scoring ${id}: ${msg}`);
      await log.moderate(
        env,
        "pipeline",
        "Persist scoring failed",
        {
          jobId: id,
          providerId: job.source,
          error: msg.slice(0, 500),
        },
        {
          category: "storage",
          eventType: "scoring_persist_failed",
          providerId: job.source,
          jobId: id,
          phase: "saveScoring",
          statusKind: "degraded",
        },
      );
      await markVisibleProcessingFailure(
      env,
      userId,
      id,
        job.source,
        `Pipeline failed while saving the AI recommendation: ${msg.slice(0, 500)}`,
        now,
        errors,
      );
      continue;
    }
    statisticsDeltas.push({
      userId,
      providerId: job.source,
      atUnix: jobWithFetchMeta.apiFetchedAtUnix ?? now,
      ...statisticsOutcomeDeltaForFinalScoring(finalScoring),
      variant: statisticsVariantFromJob(jobWithFetchMeta),
    });
    observabilityLog(
      "debug",
      "pipeline",
      "Completed fetched job processing",
      {
        jobId: id,
        providerId: job.source,
        recommendation: finalScoring.recommendation,
        fitScore: finalScoring.fit_score,
        salaryFloorForcedReject: floorReasons.length > 0,
      },
      {
        category: "system",
        eventType: "process_fetched_job_completed",
        providerId: job.source,
        jobId: id,
        phase: "processFetchedJobs",
        statusKind: "ok",
      },
    );
    processed++;

    if (scoring.recommendation === "reject") {
      continue;
    }
  }

  if (statisticsDeltas.length > 0) {
    try {
      await applyStatisticsDeltas(env.DB, statisticsDeltas);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(`statistics ${msg}`);
      await log.moderate(
        env,
        "statistics",
        "Statistics outcome write failed",
        {
          deltaCount: statisticsDeltas.length,
          error: msg.slice(0, 400),
        },
        {
          category: "system",
          eventType: "statistics_outcome_write_failed",
          phase: "processFetchedJobs",
          statusKind: "degraded",
        },
      );
    }
  }

  return { fetched: jobs.length, processed, skipped, errors };
}

export async function runSearchPipeline(env: Env, userId: string, _requestUrl?: string): Promise<{
  fetched: number;
  processed: number;
  skipped: number;
  errors: string[];
}> {
  const errors: string[] = [];
  const gate = await getPipelineFetchAllowed(env, userId);
  if (!gate.allowed) {
    await log.info(env, "pipeline", `Fetch skipped: ${gate.reason}`);
    return { fetched: 0, processed: 0, skipped: 0, errors: [gate.reason] };
  }

  const providers = await getEnabledProviders(env, userId);
  const cycleId = `manual-${Date.now()}`;

  await log.info(env, "pipeline", "Fetch started", {
    providers: providers.map((p) => p.id),
  });

  const collected: NormalizedJob[] = [];
  for (const p of providers) {
    if (!(await isExtractionActive(env, userId))) {
      errors.push(`${p.id}: skipped (extraction paused)`);
      await log.info(env, "pipeline", "Extraction paused before provider; remaining sources skipped", {
        skipped: p.id,
      });
      break;
    }
    try {
      const chunk = await p.fetchChunk(env, { userId, page: 1, pageSize: 15, cycleId });
      collected.push(...chunk.jobs);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(`${p.id}: ${msg}`);
      await log.moderate(
        env,
        "pipeline",
        `Provider fetch failed: ${p.id}`,
        {
          providerId: p.id,
          cycleId,
          error: msg.slice(0, 800),
        },
        {
          category: "vendor",
          eventType: "provider_fetch_failed",
          providerId: p.id,
          cycleId,
          phase: "runSearchPipeline",
          statusKind: "degraded",
        },
      );
    }
  }

  const processedSummary = await processFetchedJobs(env, userId, collected);
  const summary = {
    fetched: processedSummary.fetched,
    processed: processedSummary.processed,
    skipped: processedSummary.skipped,
    errors: [...errors, ...processedSummary.errors],
  };
  await log.info(env, "pipeline", "Fetch finished", summary);
  return summary;
}


