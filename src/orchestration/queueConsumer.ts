import { applyStatisticsDeltas, type StatisticsVariantDimension } from "../db/statistics";
import { BOOTSTRAP_ADMIN_ID, getUserById } from "../db/users";
import { log, observabilityLog } from "../logging/appLog";
import { dedupeKey } from "../pipeline/dedupe";
import { processFetchedJobs } from "../pipeline/runPipeline";
import { getProviderById } from "../providers";
import type { ProviderChunkResult } from "../providers/types";
import {
  claimQueueMessage,
  dedupeCycleKeys,
  heartbeatQueueMessage,
  reportOrchestrationErrorToCoordinator,
  reportProviderChunk,
  resetCoordinatorStateForInactiveUser,
} from "./client";
import type { PipelineQueueMessage } from "./types";

const PROVIDER_ERROR_BACKOFF_SECONDS = 60;
const CHUNK_HEARTBEAT_INTERVAL_SECONDS = 45;

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

async function isActiveUser(db: D1Database, userId: string): Promise<boolean> {
  const user = await getUserById(db, userId);
  return user?.status === "active";
}

function isPipelineQueueMessage(x: unknown): x is PipelineQueueMessage {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  return (
    o.kind === "provider_chunk" &&
    typeof o.userId === "string" &&
    typeof o.cycleId === "string" &&
    typeof o.seq === "number" &&
    typeof o.providerId === "string"
  );
}

function statisticsVariantForChunk(
  providerMeta: Record<string, unknown> | undefined,
  jobs: readonly import("../types/job").NormalizedJob[],
): StatisticsVariantDimension | null {
  const first = jobs[0];
  const searchQuery =
    (typeof providerMeta?.query === "string" ? providerMeta.query.trim() : "") ||
    (typeof first?.searchQuery === "string" ? first.searchQuery.trim() : "");
  if (!searchQuery) return null;
  const countryKey =
    (typeof providerMeta?.countryKey === "string" ? providerMeta.countryKey.trim() : "") ||
    (typeof first?.searchCountryKey === "string" ? first.searchCountryKey.trim() : "");
  const countryLabel =
    (typeof providerMeta?.countryLabel === "string" ? providerMeta.countryLabel.trim() : "") ||
    (typeof providerMeta?.country === "string" ? providerMeta.country.trim() : "") ||
    (typeof first?.searchCountryLabel === "string" ? first.searchCountryLabel.trim() : "");
  return {
    searchQuery,
    tier: 1,
    countryKey,
    countryLabel,
  };
}

function createChunkHeartbeater(env: Env, msg: PipelineQueueMessage): {
  beat: (stage: string, meta?: Record<string, unknown>, force?: boolean) => Promise<void>;
} {
  let lastBeatAt = 0;
  return {
    async beat(stage: string, meta?: Record<string, unknown>, force = false): Promise<void> {
      const now = Math.floor(Date.now() / 1000);
      if (!force && lastBeatAt > 0 && now - lastBeatAt < CHUNK_HEARTBEAT_INTERVAL_SECONDS) {
        return;
      }
      try {
        lastBeatAt = now;
        const heartbeat = await heartbeatQueueMessage(env, msg.userId, {
          cycleId: msg.cycleId,
          seq: msg.seq,
          providerId: msg.providerId,
          stage,
        });
        observabilityLog(
          heartbeat.extended ? "debug" : "warn",
          "orchestrator",
          heartbeat.extended ? "Queue chunk heartbeat extended" : "Queue chunk heartbeat not extended",
          {
            cycleId: msg.cycleId,
            providerId: msg.providerId,
            seq: msg.seq,
            stage,
            leaseExpiresAt: heartbeat.leaseExpiresAt,
            ...(meta ?? {}),
          },
          {
            category: "queue",
            eventType: heartbeat.extended ? "queue_chunk_heartbeat" : "queue_chunk_heartbeat_skipped",
            providerId: msg.providerId,
            cycleId: msg.cycleId,
            phase: stage,
            statusKind: heartbeat.extended ? "running" : "degraded",
          },
        );
        if (!heartbeat.extended && heartbeat.reason !== "stale_message" && heartbeat.reason !== "not_claimed") {
          await log.moderate(
            env,
            "orchestrator",
            "Queue chunk heartbeat failed to extend lease",
            {
              userId: msg.userId,
              cycleId: msg.cycleId,
              providerId: msg.providerId,
              seq: msg.seq,
              stage,
              reason: heartbeat.reason ?? "unknown",
              leaseExpiresAt: heartbeat.leaseExpiresAt,
            },
            {
              userId: msg.userId,
              category: "queue",
              eventType: "queue_chunk_heartbeat_failed",
              providerId: msg.providerId,
              cycleId: msg.cycleId,
              phase: stage,
              statusKind: "degraded",
            },
          );
        }
      } catch (error) {
        await log.moderate(
          env,
          "orchestrator",
          "Queue chunk heartbeat request failed",
          {
            userId: msg.userId,
            cycleId: msg.cycleId,
            providerId: msg.providerId,
            seq: msg.seq,
            stage,
            error: errMsg(error).slice(0, 500),
          },
          {
            userId: msg.userId,
            category: "queue",
            eventType: "queue_chunk_heartbeat_request_failed",
            providerId: msg.providerId,
            cycleId: msg.cycleId,
            phase: stage,
            statusKind: "degraded",
          },
        );
      }
    },
  };
}

async function runProviderChunk(
  env: Env,
  msg: PipelineQueueMessage,
  heartbeat?: { beat: (stage: string, meta?: Record<string, unknown>, force?: boolean) => Promise<void> },
): Promise<{
  providerResult: ProviderChunkResult;
  fetched: number;
  kept: number;
  processed: number;
  skipped: number;
  errors: string[];
}> {
  const chunkStartedAtMs = Date.now();
  const provider = getProviderById(msg.providerId);
  if (!provider) {
    await log.critical(
      env,
      "orchestrator",
      "Queue referenced unknown provider",
      {
        userId: msg.userId,
        cycleId: msg.cycleId,
        providerId: msg.providerId,
        seq: msg.seq,
      },
      {
        userId: msg.userId,
        category: "queue",
        eventType: "queue_unknown_provider",
        cycleId: msg.cycleId,
        phase: "runProviderChunk",
        statusKind: "failed",
      },
    );
    return {
      providerResult: {
        jobs: [],
        more: false,
        doneForCycle: false,
        nextEligibleAt: Math.floor(Date.now() / 1000) + PROVIDER_ERROR_BACKOFF_SECONDS,
        meta: { reason: "provider_not_found" },
      },
      fetched: 0,
      kept: 0,
      processed: 0,
      skipped: 0,
      errors: [`Unknown provider: ${msg.providerId}`],
    };
  }

  let providerResult: ProviderChunkResult;
  try {
    await log.info(env, "orchestrator", "Provider chunk started", {
      cycleId: msg.cycleId,
      providerId: msg.providerId,
      seq: msg.seq,
    });
    observabilityLog(
      "debug",
      "orchestrator",
      "Provider chunk fetch started",
      {
        cycleId: msg.cycleId,
        providerId: msg.providerId,
        seq: msg.seq,
      },
      {
        category: "queue",
        eventType: "provider_chunk_fetch_started",
        providerId: msg.providerId,
        cycleId: msg.cycleId,
        phase: "runProviderChunk",
        statusKind: "running",
      },
    );
    await heartbeat?.beat("provider_fetch_start", {}, true);
    providerResult = await provider.fetchChunk(env, { userId: msg.userId, page: 1, pageSize: 15, cycleId: msg.cycleId });
    observabilityLog(
      "debug",
      "orchestrator",
      "Provider chunk fetch completed",
      {
        cycleId: msg.cycleId,
        providerId: msg.providerId,
        seq: msg.seq,
        durationMs: Date.now() - chunkStartedAtMs,
        fetched: providerResult.jobs.length,
        more: providerResult.more,
        doneForCycle: providerResult.doneForCycle,
        nextEligibleAt: providerResult.nextEligibleAt ?? null,
      },
      {
        category: "queue",
        eventType: "provider_chunk_fetch_completed",
        providerId: msg.providerId,
        cycleId: msg.cycleId,
        phase: "runProviderChunk",
        statusKind: "running",
      },
    );
    await heartbeat?.beat("provider_fetch_done", {
      fetched: providerResult.jobs.length,
      doneForCycle: providerResult.doneForCycle,
    });
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    await log.moderate(
      env,
      "orchestrator",
      "Provider chunk failed",
      {
        userId: msg.userId,
        cycleId: msg.cycleId,
        providerId: msg.providerId,
        seq: msg.seq,
        error: error.slice(0, 500),
      },
      {
        userId: msg.userId,
        category: "vendor",
        eventType: "provider_chunk_failed",
        providerId: msg.providerId,
        cycleId: msg.cycleId,
        phase: "runProviderChunk",
        statusKind: "degraded",
      },
    );
    return {
      providerResult: {
        jobs: [],
        more: true,
        doneForCycle: false,
        nextEligibleAt: Math.floor(Date.now() / 1000) + PROVIDER_ERROR_BACKOFF_SECONDS,
        meta: { reason: "provider_error" },
      },
      fetched: 0,
      kept: 0,
      processed: 0,
      skipped: 0,
      errors: [`${msg.providerId}: ${error}`],
    };
  }

  let keptJobs = providerResult.jobs;
  if (keptJobs.length > 0) {
    await heartbeat?.beat("cycle_dedupe_start", { fetched: keptJobs.length });
    try {
      const dedupe = await dedupeCycleKeys(env, msg.userId, {
        cycleId: msg.cycleId,
        keys: keptJobs.map(dedupeKey),
      });
      keptJobs = keptJobs.filter((_, idx) => dedupe.keep[idx]);
      await heartbeat?.beat("cycle_dedupe_done", { keptAfterCycleDedupe: keptJobs.length });
    } catch (e) {
      const error = errMsg(e);
      await log.moderate(
        env,
        "orchestrator",
        "Cycle dedupe failed",
        {
          userId: msg.userId,
          cycleId: msg.cycleId,
          providerId: msg.providerId,
          seq: msg.seq,
          error: error.slice(0, 500),
        },
        {
          userId: msg.userId,
          category: "orchestration",
          eventType: "cycle_dedupe_failed",
          providerId: msg.providerId,
          cycleId: msg.cycleId,
          phase: "dedupeCycleKeys",
          statusKind: "degraded",
        },
      );
      await reportOrchestrationErrorToCoordinator(env, msg.userId, {
        message: `dedupeCycleKeys: ${error}`,
        phase: "dedupeCycleKeys",
      });
      throw e;
    }
  }

  const providerMeta =
    providerResult.meta && typeof providerResult.meta === "object"
      ? (providerResult.meta as Record<string, unknown>)
      : undefined;
  try {
    await applyStatisticsDeltas(env.DB, [
      {
        userId: msg.userId,
        providerId: msg.providerId,
        atUnix: Math.floor(Date.now() / 1000),
        jobsReceived: providerResult.jobs.length,
        jobsKept: keptJobs.length,
        variant: statisticsVariantForChunk(providerMeta, providerResult.jobs),
      },
    ]);
  } catch (error) {
    const msgText = errMsg(error);
    await log.moderate(
      env,
      "statistics",
      "Statistics intake write failed",
      {
        userId: msg.userId,
        providerId: msg.providerId,
        cycleId: msg.cycleId,
        error: msgText.slice(0, 400),
      },
      {
        userId: msg.userId,
        category: "system",
        eventType: "statistics_intake_write_failed",
        providerId: msg.providerId,
        cycleId: msg.cycleId,
        phase: "runProviderChunk",
        statusKind: "degraded",
      },
    );
  }

  observabilityLog(
    "debug",
    "orchestrator",
    "Pipeline job processing started",
    {
      cycleId: msg.cycleId,
      providerId: msg.providerId,
      seq: msg.seq,
      keptJobs: keptJobs.length,
    },
    {
      category: "queue",
      eventType: "pipeline_job_processing_started",
      providerId: msg.providerId,
      cycleId: msg.cycleId,
      phase: "processFetchedJobs",
      statusKind: "running",
    },
  );
  await heartbeat?.beat("process_jobs_start", { keptJobs: keptJobs.length }, true);
  const processingStartedAtMs = Date.now();
  const processedSummary = await processFetchedJobs(env, msg.userId, keptJobs, {
    onJobStart: async ({ index, total, job }) => {
      await heartbeat?.beat("process_job_start", {
        index,
        total,
        jobSource: job.source,
        externalId: job.externalId,
        title: job.title?.slice(0, 160) ?? null,
      });
      observabilityLog(
        "debug",
        "pipeline",
        "Processing fetched job",
        {
          cycleId: msg.cycleId,
          providerId: msg.providerId,
          seq: msg.seq,
          index,
          total,
          externalId: job.externalId,
          title: job.title?.slice(0, 160) ?? null,
          company: job.company?.slice(0, 160) ?? null,
        },
        {
          category: "system",
          eventType: "process_fetched_job_started",
          providerId: msg.providerId,
          cycleId: msg.cycleId,
          phase: "processFetchedJobs",
          statusKind: "running",
        },
      );
    },
  });
  observabilityLog(
    "debug",
    "orchestrator",
    "Pipeline job processing completed",
    {
      cycleId: msg.cycleId,
      providerId: msg.providerId,
      seq: msg.seq,
      durationMs: Date.now() - processingStartedAtMs,
      processed: processedSummary.processed,
      skipped: processedSummary.skipped,
      errorCount: processedSummary.errors.length,
    },
    {
      category: "queue",
      eventType: "pipeline_job_processing_completed",
      providerId: msg.providerId,
      cycleId: msg.cycleId,
      phase: "processFetchedJobs",
      statusKind: processedSummary.errors.length > 0 ? "degraded" : "ok",
    },
  );
  await heartbeat?.beat(
    "process_jobs_done",
    {
      processed: processedSummary.processed,
      skipped: processedSummary.skipped,
      errorCount: processedSummary.errors.length,
    },
    true,
  );
  return {
    providerResult,
    fetched: providerResult.jobs.length,
    kept: keptJobs.length,
    processed: processedSummary.processed,
    skipped: processedSummary.skipped,
    errors: processedSummary.errors,
  };
}

export async function handlePipelineQueue(
  batch: MessageBatch<PipelineQueueMessage>,
  env: Env,
): Promise<void> {
  for (const message of batch.messages) {
    const body = message.body;
    if (!isPipelineQueueMessage(body)) {
      await log.critical(
        env,
        "orchestrator",
        "Dropped malformed queue message",
        { body },
        {
          category: "queue",
          eventType: "queue_message_malformed",
          phase: "queue_validate",
          statusKind: "failed",
          fingerprint: "queue_message_malformed",
        },
      );
      await reportOrchestrationErrorToCoordinator(env, BOOTSTRAP_ADMIN_ID, {
        message: "Malformed queue message (not provider_chunk)",
        phase: "queue_validate",
      });
      continue;
    }

    try {
      if (!(await isActiveUser(env.DB, body.userId))) {
        await log.info(env, "orchestrator", "Skipped queue message for deleted or disabled user", {
          userId: body.userId,
          cycleId: body.cycleId,
          providerId: body.providerId,
          seq: body.seq,
        });
        await resetCoordinatorStateForInactiveUser(env, body.userId);
        continue;
      }

      const claim = await claimQueueMessage(env, body.userId, {
        cycleId: body.cycleId,
        seq: body.seq,
        providerId: body.providerId,
      });
      if (!claim.execute) {
        await log.info(env, "orchestrator", "Skipped stale/paused queue message", {
          cycleId: body.cycleId,
          providerId: body.providerId,
          seq: body.seq,
          reason: claim.reason ?? "not_claimed",
        });
        continue;
      }

      const chunkStartedAtMs = Date.now();
      const heartbeat = createChunkHeartbeater(env, body);
      await heartbeat.beat("claimed", {}, true);
      const result = await runProviderChunk(env, body, heartbeat);
      if (!(await isActiveUser(env.DB, body.userId))) {
        await log.info(env, "orchestrator", "Skipped queue report after user deletion/disable", {
          userId: body.userId,
          cycleId: body.cycleId,
          providerId: body.providerId,
          seq: body.seq,
        });
        await resetCoordinatorStateForInactiveUser(env, body.userId);
        continue;
      }
      if (result.errors.length > 0) {
        await log.moderate(
          env,
          "orchestrator",
          "Pipeline chunk finished with per-job processing errors",
          {
            userId: body.userId,
            cycleId: body.cycleId,
            providerId: body.providerId,
            seq: body.seq,
            errorCount: result.errors.length,
            sample: result.errors.slice(0, 12).join(" | ").slice(0, 1800),
          },
          {
            userId: body.userId,
            category: "system",
            eventType: "pipeline_processing_errors",
            providerId: body.providerId,
            cycleId: body.cycleId,
            phase: "processFetchedJobs",
            statusKind: "degraded",
          },
        );
      }
      try {
        await heartbeat.beat(
          "report_start",
          {
            fetched: result.fetched,
            kept: result.kept,
            processed: result.processed,
            skipped: result.skipped,
            errorCount: result.errors.length,
          },
          true,
        );
        await reportProviderChunk(env, body.userId, {
          cycleId: body.cycleId,
          seq: body.seq,
          providerId: body.providerId,
          providerResult: {
            more: result.providerResult.more,
            doneForCycle: result.providerResult.doneForCycle,
            nextEligibleAt: result.providerResult.nextEligibleAt,
            meta: result.providerResult.meta,
          },
          processing: {
            fetched: result.fetched,
            kept: result.kept,
            processed: result.processed,
            skipped: result.skipped,
            errors: result.errors,
          },
        });
        observabilityLog(
          "debug",
          "orchestrator",
          "Provider chunk report completed",
          {
            cycleId: body.cycleId,
            providerId: body.providerId,
            seq: body.seq,
            fetched: result.fetched,
            kept: result.kept,
            processed: result.processed,
            skipped: result.skipped,
            errorCount: result.errors.length,
          },
          {
            category: "queue",
            eventType: "provider_chunk_report_completed",
            providerId: body.providerId,
            cycleId: body.cycleId,
            phase: "reportProviderChunk",
            statusKind: result.errors.length > 0 ? "degraded" : "ok",
          },
        );
        observabilityLog(
          "debug",
          "orchestrator",
          "Queue chunk completed end-to-end",
          {
            cycleId: body.cycleId,
            providerId: body.providerId,
            seq: body.seq,
            durationMs: Date.now() - chunkStartedAtMs,
            fetched: result.fetched,
            kept: result.kept,
            processed: result.processed,
            skipped: result.skipped,
            errorCount: result.errors.length,
          },
          {
            category: "queue",
            eventType: "queue_chunk_completed",
            providerId: body.providerId,
            cycleId: body.cycleId,
            phase: "queue_consumer",
            statusKind: result.errors.length > 0 ? "degraded" : "ok",
          },
        );
      } catch (e) {
        const error = errMsg(e);
        await log.moderate(
          env,
          "orchestrator",
          "Coordinator /report failed after chunk; awaiting pending-lease recovery",
          {
            userId: body.userId,
            cycleId: body.cycleId,
            providerId: body.providerId,
            seq: body.seq,
            error: error.slice(0, 500),
          },
          {
            userId: body.userId,
            category: "orchestration",
            eventType: "provider_chunk_report_failed",
            providerId: body.providerId,
            cycleId: body.cycleId,
            phase: "reportProviderChunk",
            statusKind: "degraded",
          },
        );
        try {
          await reportOrchestrationErrorToCoordinator(env, body.userId, {
            message: `reportProviderChunk: ${error}`,
            phase: "reportProviderChunk",
          });
        } catch {
          // The pending-lease timeout will still recover the coordinator even if this follow-up fails.
        }
        continue;
      }
    } catch (e) {
      await log.critical(
        env,
        "orchestrator",
        "Queue consumer failed",
        {
          userId: isPipelineQueueMessage(body) ? body.userId : BOOTSTRAP_ADMIN_ID,
          error: errMsg(e).slice(0, 500),
          body,
        },
        {
          userId: isPipelineQueueMessage(body) ? body.userId : BOOTSTRAP_ADMIN_ID,
          category: "queue",
          eventType: "queue_consumer_failed",
          providerId: isPipelineQueueMessage(body) ? body.providerId : null,
          cycleId: isPipelineQueueMessage(body) ? body.cycleId : null,
          phase: "queue_consumer",
          statusKind: "failed",
        },
      );
      const errUserId = isPipelineQueueMessage(body) ? body.userId : BOOTSTRAP_ADMIN_ID;
      await reportOrchestrationErrorToCoordinator(env, errUserId, {
        message: errMsg(e),
        phase: "queue_consumer",
      });
      throw e;
    }
  }
}
