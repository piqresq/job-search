import { log } from "../logging/appLog";
import type { JobSourceId } from "../types/job";
import type {
  CoordinatorClaimResponse,
  CoordinatorDedupeResponse,
  CoordinatorHeartbeatResponse,
  CoordinatorReportResponse,
  CoordinatorResetResponse,
  CoordinatorStartResponse,
  CoordinatorStatusResponse,
  PipelineQueueMessage,
  ProviderChunkReport,
} from "./types";

const BASE_URL = "https://pipeline-coordinator";

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function getCoordinatorStub(env: Env, userId: string): DurableObjectStub {
  const id = env.PIPELINE_COORDINATOR.idFromName(userId);
  return env.PIPELINE_COORDINATOR.get(id);
}

async function postJson<T>(env: Env, userId: string, path: string, body: unknown): Promise<T> {
  const stub = getCoordinatorStub(env, userId);
  const res = await stub.fetch(
    new Request(`${BASE_URL}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify(body),
    }),
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Coordinator ${path} HTTP ${res.status}: ${text.slice(0, 400)}`);
  }
  return (await res.json()) as T;
}

export async function startOrResumeCoordinator(
  env: Env,
  userId: string,
  body: { reason: string },
): Promise<CoordinatorStartResponse> {
  return postJson<CoordinatorStartResponse>(env, userId, "/start", body);
}

/** Clears `request_cap` done-for-cycle pause for listed providers after dashboard raises caps. */
export async function clearRequestCapPauseForProviders(
  env: Env,
  userId: string,
  body: { providerIds: JobSourceId[] },
): Promise<{ ok: true; cleared: number; status: string; wakeAt: number | null }> {
  return postJson(env, userId, "/clear-request-cap-pause", body);
}

/** Clears D1 exhaustion/freeze pause state without touching daily-cap counters. */
export async function clearExhaustPause(env: Env, userId: string): Promise<{
  ok: true;
  clearedProviders: number;
  status: string;
  wakeAt: number | null;
  cycleId: string | null;
}> {
  return postJson(env, userId, "/clear-exhaust-pause", {});
}

/** Clears one user's Durable Object coordinator state after admin hard-delete. */
export async function resetCoordinatorStateForDeletedUser(
  env: Env,
  userId: string,
): Promise<CoordinatorResetResponse> {
  return postJson<CoordinatorResetResponse>(env, userId, "/reset-deleted-user", {});
}

export async function claimQueueMessage(
  env: Env,
  userId: string,
  body: Pick<PipelineQueueMessage, "cycleId" | "seq" | "providerId">,
): Promise<CoordinatorClaimResponse> {
  return postJson<CoordinatorClaimResponse>(env, userId, "/claim", body);
}

export async function heartbeatQueueMessage(
  env: Env,
  userId: string,
  body: Pick<PipelineQueueMessage, "cycleId" | "seq" | "providerId"> & { stage?: string },
): Promise<CoordinatorHeartbeatResponse> {
  return postJson<CoordinatorHeartbeatResponse>(env, userId, "/heartbeat", body);
}

export async function dedupeCycleKeys(
  env: Env,
  userId: string,
  body: { cycleId: string; keys: string[] },
): Promise<CoordinatorDedupeResponse> {
  return postJson<CoordinatorDedupeResponse>(env, userId, "/dedupe", body);
}

export async function reportProviderChunk(
  env: Env,
  userId: string,
  body: ProviderChunkReport,
): Promise<CoordinatorReportResponse> {
  return postJson<CoordinatorReportResponse>(env, userId, "/report", body);
}

/** GET /status — coordinator health for dashboard (no POST body). */
export async function getCoordinatorStatus(
  env: Env,
  userId: string,
): Promise<CoordinatorStatusResponse | { ok: false; error: string }> {
  try {
    const stub = getCoordinatorStub(env, userId);
    const res = await stub.fetch(new Request(`${BASE_URL}/status`, { method: "GET" }));
    const j = (await res.json()) as { ok?: boolean };
    if (!res.ok) {
      return { ok: false, error: `http_${res.status}` };
    }
    if (j && j.ok === true) {
      return j as CoordinatorStatusResponse;
    }
    return { ok: false, error: "bad_body" };
  } catch (e) {
    return { ok: false, error: errMsg(e) };
  }
}

/** POST /orchestration-error — queue / worker reports non-provider failures. */
export async function reportOrchestrationErrorToCoordinator(
  env: Env,
  userId: string,
  body: { message: string; phase: string },
): Promise<void> {
  try {
    const stub = getCoordinatorStub(env, userId);
    const res = await stub.fetch(
      new Request(`${BASE_URL}/orchestration-error`, {
        method: "POST",
        headers: { "content-type": "application/json; charset=utf-8" },
        body: JSON.stringify({
          message: body.message.slice(0, 2000),
          phase: body.phase.slice(0, 200),
        }),
      }),
    );
    if (!res.ok) {
      await log.critical(
        env,
        "orchestrator",
        "orchestration-error POST failed",
        { status: res.status, phase: body.phase },
        {
          category: "queue",
          eventType: "orchestration_error_post_failed",
          phase: body.phase,
          statusKind: "failed",
        },
      );
    }
  } catch (e) {
    await log.critical(
      env,
      "orchestrator",
      "reportOrchestrationErrorToCoordinator threw",
      {
        err: errMsg(e).slice(0, 400),
        phase: body.phase,
      },
      {
        category: "queue",
        eventType: "orchestration_error_post_threw",
        phase: body.phase,
        statusKind: "failed",
      },
    );
  }
}

export function makeProviderChunkMessage(
  userId: string,
  cycleId: string,
  seq: number,
  providerId: JobSourceId,
  requestedAt: number,
): PipelineQueueMessage {
  return {
    kind: "provider_chunk",
    userId,
    cycleId,
    seq,
    providerId,
    requestedAt,
  };
}
