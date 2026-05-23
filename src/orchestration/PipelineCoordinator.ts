import { DurableObject } from "cloudflare:workers";
import { getPipelineFetchAllowed, getResolvedProviderDailyRequestCap } from "../db/appSettings";
import { clearProviderExhaustionState, rolloverProviderCycleState } from "../db/providerScheduler";
import { BOOTSTRAP_ADMIN_ID, getUserById } from "../db/users";
import {
  getProviderUtcDayRequestCount,
  setLinkedinFreezeUntil,
  utcYmdFromUnix,
} from "../db/pipelineState";
import { nextUtcMidnightUnix } from "../lib/nextUtcMidnight";
import { log, observabilityLog } from "../logging/appLog";
import { getEnabledProviders } from "../providers";
import type { JobSourceId } from "../types/job";
import { makeProviderChunkMessage } from "./client";
import { pickProviderByBudgetFill, type ProviderBudgetInfo } from "./providerRotation";
import { deriveProviderPauseKind } from "./providerPauseKind";
import type {
  CoordinatorClaimResponse,
  CoordinatorDedupeResponse,
  CoordinatorHeartbeatResponse,
  CoordinatorReportResponse,
  CoordinatorStartResponse,
  CoordinatorState,
  CoordinatorStatusResponse,
  OrchestrationError,
  ProviderChunkReport,
  ProviderCycleState,
} from "./types";

const STATE_KEY = "state";
/**
 * Maximum time the coordinator keeps a provider slot marked as pending without any heartbeat from
 * the queue consumer. The consumer beats every `CHUNK_HEARTBEAT_INTERVAL_SECONDS` (45s) while a
 * chunk runs, so anything >> a few heartbeats is safe. 10 minutes gives ~13× headroom vs the
 * beat interval and bounds the "stuck slot" blackout when the queue consumer is cancelled
 * mid-flight (deploys, worker-timeout, etc.) without ever ack'ing the queue message.
 */
const PENDING_CHUNK_LEASE_SECONDS = 10 * 60;

/**
 * Cloudflare Queues producer occasionally returns a transient 500/502/503 or surfaces
 * "Internal Server Error" to {@link Queue.send}. One transient blip used to record a
 * `critical` orchestration error and stall the pump until the *previous* pending-lease
 * alarm fired 10 minutes later (see incident 2026-04-22 09:32 UTC).
 *
 * We retry a handful of times with short jittered backoff (enough to ride out single-digit
 * second blips) before bubbling up. `QUEUE_SEND_RECOVERY_ALARM_SECONDS` is used to re-arm
 * the coordinator quickly when retries are exhausted, so operators don't have to wait the
 * full lease window for self-healing.
 */
const QUEUE_SEND_MAX_ATTEMPTS = 4;
const QUEUE_SEND_RETRY_BASE_MS = 200;
const QUEUE_SEND_RECOVERY_ALARM_SECONDS = 30;

function isLikelyTransientQueueError(e: unknown): boolean {
  const msg = (e instanceof Error ? e.message : String(e)).toLowerCase();
  return (
    msg.includes("internal server error") ||
    msg.includes("service unavailable") ||
    msg.includes("bad gateway") ||
    msg.includes("gateway timeout") ||
    msg.includes("timeout") ||
    msg.includes("timed out") ||
    msg.includes("network") ||
    msg.includes("connection") ||
    msg.includes("fetch failed") ||
    msg.includes("socket") ||
    // HTTP status hint as sent by Queues' producer API on retryable failures.
    /\b5\d{2}\b/.test(msg)
  );
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function newProviderState(): ProviderCycleState {
  return {
    doneForCycle: false,
    nextEligibleAt: 0,
    consecutiveErrors: 0,
    lastError: null,
    lastPauseKind: null,
  };
}

function newState(now: number): CoordinatorState {
  return {
    cycleId: null,
    status: "idle",
    providerCurrentWeights: {},
    nextSeq: 1,
    pendingSeq: null,
    pendingProviderId: null,
    pendingClaimedAt: null,
    pendingLeaseExpiresAt: null,
    wakeAt: null,
    lastEventAt: now,
    providerStates: {},
    seenDedupeKeys: [],
    orchestrationError: null,
  };
}

function providerStateSnapshot(providerId: JobSourceId, state: ProviderCycleState) {
  return {
    providerId,
    doneForCycle: state.doneForCycle,
    nextEligibleAt: state.nextEligibleAt,
    consecutiveErrors: state.consecutiveErrors,
    lastPauseKind: state.lastPauseKind,
    hasLastError: Boolean(state.lastError),
  };
}

function nextCycleId(now: number): string {
  return `${now}-${Math.random().toString(36).slice(2, 8)}`;
}

function cycleStartedAtUnix(cycleId: string | null): number | null {
  if (!cycleId) return null;
  const rawPrefix = cycleId.split("-", 1)[0]?.trim();
  if (!rawPrefix) return null;
  const startedAt = parseInt(rawPrefix, 10);
  return Number.isFinite(startedAt) && startedAt > 0 ? startedAt : null;
}

function cycleNeedsUtcDayRollover(cycleId: string | null, now: number): boolean {
  const startedAt = cycleStartedAtUnix(cycleId);
  if (!startedAt) return false;
  return nextUtcMidnightUnix(startedAt) <= now;
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Cloudflare platform message when a DO is restarted (deploy / migration). Not an app bug. */
function durableObjectDeployNoiseMessageText(raw: string): boolean {
  const m = raw.toLowerCase();
  return m.includes("durable object reset") && m.includes("code was updated");
}

/**
 * Cloudflare throws this while the DO is being restarted (new Worker version, platform migration).
 * It is not a pipeline logic bug; logging it as a critical orchestration failure is misleading noise.
 */
function isDurableObjectDeployResetError(e: unknown): boolean {
  return durableObjectDeployNoiseMessageText(errMsg(e));
}

export class PipelineCoordinator extends DurableObject<Env> {
  /** User that owns this DO instance. Derived from the DO name set via idFromName(userId). */
  private get userId(): string {
    return this.ctx.id.name ?? BOOTSTRAP_ADMIN_ID;
  }

  private async loadState(): Promise<CoordinatorState> {
    const now = Math.floor(Date.now() / 1000);
    const raw = await this.ctx.storage.get<CoordinatorState>(STATE_KEY);
    if (!raw) return newState(now);
    return {
      cycleId: raw.cycleId ?? null,
      status: raw.status ?? "idle",
      providerCurrentWeights: raw.providerCurrentWeights ?? {},
      nextSeq: raw.nextSeq ?? 1,
      pendingSeq: raw.pendingSeq ?? null,
      pendingProviderId: raw.pendingProviderId ?? null,
      pendingClaimedAt: raw.pendingClaimedAt ?? null,
      pendingLeaseExpiresAt: raw.pendingLeaseExpiresAt ?? null,
      wakeAt: raw.wakeAt ?? null,
      lastEventAt: raw.lastEventAt ?? now,
      providerStates: raw.providerStates ?? {},
      seenDedupeKeys: Array.isArray(raw.seenDedupeKeys) ? raw.seenDedupeKeys : [],
      orchestrationError: raw.orchestrationError ?? null,
    };
  }

  private clearPending(state: CoordinatorState): void {
    state.pendingSeq = null;
    state.pendingProviderId = null;
    state.pendingClaimedAt = null;
    state.pendingLeaseExpiresAt = null;
  }

  private pendingLeaseExpiresAt(now: number): number {
    return now + PENDING_CHUNK_LEASE_SECONDS;
  }

  private async saveState(state: CoordinatorState): Promise<void> {
    await this.ctx.storage.put(STATE_KEY, state);
  }

  private async isActiveOwner(): Promise<boolean> {
    const user = await getUserById(this.env.DB, this.userId);
    return user?.status === "active";
  }

  private async resetInactiveUserState(now = Math.floor(Date.now() / 1000)): Promise<CoordinatorState> {
    const state = newState(now);
    await this.ctx.storage.delete(STATE_KEY);
    await this.ctx.storage.deleteAlarm();
    return state;
  }

  private async pauseIfInactiveOwner(now: number): Promise<CoordinatorState | null> {
    if (await this.isActiveOwner()) return null;
    const state = await this.resetInactiveUserState(now);
    observabilityLog(
      "debug",
      "orchestrator",
      "Coordinator reset for deleted or disabled user",
      { userId: this.userId },
      {
        category: "orchestration",
        eventType: "coordinator_inactive_user_reset",
        phase: "inactive_user_guard",
        statusKind: "paused",
      },
    );
    return state;
  }

  private async recordOrchestrationError(
    state: CoordinatorState,
    message: string,
    phase: string,
  ): Promise<void> {
    const now = Math.floor(Date.now() / 1000);
    const err: OrchestrationError = {
      message: message.slice(0, 2000),
      at: now,
      phase: phase.slice(0, 200),
    };
    state.orchestrationError = err;
    state.lastEventAt = now;
    await log.critical(
      this.env,
      "orchestrator",
      "Orchestration failure",
      {
        userId: this.userId,
        phase: err.phase,
        message: err.message.slice(0, 500),
      },
      {
        userId: this.userId,
        category: "orchestration",
        eventType: "orchestration_failure",
        cycleId: state.cycleId,
        phase: err.phase,
        statusKind: "failed",
      },
    );
  }

  private async recordOrchestrationErrorFromCatch(
    state: CoordinatorState,
    e: unknown,
    phase: string,
  ): Promise<void> {
    if (isDurableObjectDeployResetError(e)) {
      await log.status(
        this.env,
        "orchestrator",
        "Coordinator step interrupted by Durable Object deploy/reset (benign)",
        { userId: this.userId, phase, detail: errMsg(e).slice(0, 500) },
        {
          userId: this.userId,
          category: "orchestration",
          eventType: "do_deploy_reset",
          phase,
          statusKind: "ok",
          fingerprint: "do_deploy_reset",
        },
      );
      return;
    }
    await this.recordOrchestrationError(state, errMsg(e), phase);
  }

  private async enabledProviderIds(): Promise<JobSourceId[]> {
    const providers = await getEnabledProviders(this.env, this.userId);
    return providers.map((p) => p.id);
  }

  private getProviderState(state: CoordinatorState, providerId: JobSourceId): ProviderCycleState {
    const raw = state.providerStates[providerId];
    if (!raw) return newProviderState();
    return {
      doneForCycle: raw.doneForCycle ?? false,
      nextEligibleAt: raw.nextEligibleAt ?? 0,
      consecutiveErrors: raw.consecutiveErrors ?? 0,
      lastError: raw.lastError ?? null,
      lastPauseKind: raw.lastPauseKind ?? null,
    };
  }

  private allEnabledProvidersDone(state: CoordinatorState, enabled: readonly JobSourceId[]): boolean {
    if (!enabled.length) return false;
    return enabled.every((providerId) => this.getProviderState(state, providerId).doneForCycle);
  }

  /**
   * Next time a fully-completed cycle may start again.
   * Default is next UTC midnight; per-provider {@link ProviderCycleState.nextEligibleAt} may be earlier.
   */
  private nextCompletedCycleWakeAt(
    state: CoordinatorState,
    enabled: readonly JobSourceId[],
    now: number,
  ): number {
    let wakeAt = nextUtcMidnightUnix(now);
    for (const providerId of enabled) {
      const providerState = this.getProviderState(state, providerId);
      if (!providerState.doneForCycle) continue;
      if (providerState.nextEligibleAt > 0 && providerState.nextEligibleAt < wakeAt) {
        wakeAt = providerState.nextEligibleAt;
      }
    }
    return wakeAt;
  }

  private resetForNewCycle(
    state: CoordinatorState,
    now: number,
    enabled: readonly JobSourceId[],
  ): CoordinatorState {
    const providerStates: Partial<Record<JobSourceId, ProviderCycleState>> = {};
    for (const providerId of enabled) {
      providerStates[providerId] = newProviderState();
    }
    return {
      cycleId: nextCycleId(now),
      status: "running",
      providerCurrentWeights: {},
      nextSeq: 1,
      pendingSeq: null,
      pendingProviderId: null,
      pendingClaimedAt: null,
      pendingLeaseExpiresAt: null,
      wakeAt: null,
      lastEventAt: now,
      providerStates,
      seenDedupeKeys: [],
      orchestrationError: null,
    };
  }

  private async rolloverCycleForUtcBoundary(
    state: CoordinatorState,
    now: number,
    enabled: readonly JobSourceId[],
  ): Promise<CoordinatorState> {
    const previousCycleId = state.cycleId;
    state = this.resetForNewCycle(state, now, enabled);
    for (const providerId of enabled) {
      await rolloverProviderCycleState(this.env.DB, this.userId, providerId, state.cycleId!, now);
    }
    await log.status(
      this.env,
      "orchestrator",
      "Starting new pipeline cycle",
      {
        userId: this.userId,
        cycleId: state.cycleId,
        previousCycleId,
        providers: enabled,
        reason: "utc_day_rollover",
      },
      {
        userId: this.userId,
        category: "orchestration",
        eventType: "cycle_started",
        cycleId: state.cycleId,
        statusKind: "running",
      },
    );
    return state;
  }

  /** Returns false if alarm API failed (orchestration error recorded on `state`). */
  private async setAlarmSeconds(
    state: CoordinatorState,
    whenUnixSeconds: number | null,
    phase: string,
  ): Promise<boolean> {
    try {
      if (!whenUnixSeconds || whenUnixSeconds <= 0) {
        await this.ctx.storage.deleteAlarm();
      } else {
        await this.ctx.storage.setAlarm(whenUnixSeconds * 1000);
      }
      return true;
    } catch (e) {
      await this.recordOrchestrationErrorFromCatch(state, e, phase);
      return false;
    }
  }

  private async applyBlockedFetchGate(
    state: CoordinatorState,
    gate: Awaited<ReturnType<typeof getPipelineFetchAllowed>>,
    now: number,
    phase: string,
  ): Promise<CoordinatorState> {
    state.status = gate.reason === "API_EXTRACTION_DISABLED" ? "paused" : "sleeping";
    this.clearPending(state);
    state.lastEventAt = now;
    state.orchestrationError = null;
    state.wakeAt =
      gate.reason === "OUTSIDE_OPERATIONAL_HOURS" && gate.nextAllowedAt && gate.nextAllowedAt > now
        ? gate.nextAllowedAt
        : null;
    const alarmOk = await this.setAlarmSeconds(state, state.wakeAt, phase);
    if (!alarmOk) {
      await this.saveState(state);
      return state;
    }
    await log.status(
      this.env,
      "orchestrator",
      "Fetch gate blocked coordinator",
      {
        userId: this.userId,
        reason: gate.reason,
        nextAllowedAt: state.wakeAt,
      },
      {
        userId: this.userId,
        category: "orchestration",
        eventType: "fetch_gate_blocked",
        cycleId: state.cycleId,
        phase,
        statusKind: "blocked",
        fingerprint: `fetch_gate_blocked|${gate.reason}`,
      },
    );
    await this.saveState(state);
    return state;
  }

  /**
   * Sends to the pipeline queue with short-backoff retries for transient producer errors.
   * Returns `null` on success, or the last error on exhaustion (caller decides severity).
   */
  private async sendChunkMessageWithRetry(
    msg: ReturnType<typeof makeProviderChunkMessage>,
  ): Promise<{ attempts: number; transientErrors: string[] } | { error: unknown; attempts: number }> {
    const transientErrors: string[] = [];
    for (let attempt = 1; attempt <= QUEUE_SEND_MAX_ATTEMPTS; attempt++) {
      try {
        await this.env.PIPELINE_QUEUE.send(msg);
        return { attempts: attempt, transientErrors };
      } catch (e) {
        const last = attempt === QUEUE_SEND_MAX_ATTEMPTS;
        if (last || !isLikelyTransientQueueError(e)) {
          return { error: e, attempts: attempt };
        }
        const detail = (e instanceof Error ? e.message : String(e)).slice(0, 200);
        transientErrors.push(detail);
        const jitter = Math.floor(Math.random() * QUEUE_SEND_RETRY_BASE_MS);
        const backoffMs = QUEUE_SEND_RETRY_BASE_MS * 2 ** (attempt - 1) + jitter;
        await sleep(backoffMs);
      }
    }
    // Unreachable — loop always returns.
    return { error: new Error("queue_send_retry_loop_exit"), attempts: QUEUE_SEND_MAX_ATTEMPTS };
  }

  /** Returns false if queue send or alarm clear failed. */
  private async enqueueNextChunk(
    state: CoordinatorState,
    providerId: JobSourceId,
    now: number,
  ): Promise<boolean> {
    if (!state.cycleId) {
      await this.recordOrchestrationError(state, "Coordinator has no active cycle id", "enqueueNextChunk");
      return false;
    }
    const msg = makeProviderChunkMessage(this.userId, state.cycleId, state.nextSeq, providerId, now);
    const result = await this.sendChunkMessageWithRetry(msg);

    if ("error" in result) {
      // Log recovered-but-noisy transient retries at low severity for post-mortem, but don't
      // set a critical orchestrationError — we'll also schedule a fast recovery alarm so the
      // pump retries in ~30s without waiting for the 10-minute pending-lease timeout.
      await this.recordOrchestrationErrorFromCatch(state, result.error, "enqueueNextChunk");
      const recoveryAt = now + QUEUE_SEND_RECOVERY_ALARM_SECONDS;
      const alarmOk = await this.setAlarmSeconds(state, recoveryAt, "enqueueNextChunk_recovery_alarm");
      if (alarmOk) {
        observabilityLog(
          "warn",
          "orchestrator",
          "Queue send exhausted retries; scheduled recovery alarm",
          {
            cycleId: state.cycleId,
            providerId,
            attempts: result.attempts,
            recoveryAt,
          },
          {
            category: "queue",
            eventType: "queue_send_recovery_scheduled",
            cycleId: state.cycleId,
            providerId,
            phase: "enqueueNextChunk",
            statusKind: "degraded",
          },
        );
      }
      return false;
    }

    if (result.transientErrors.length > 0) {
      observabilityLog(
        "warn",
        "orchestrator",
        "Queue send recovered after transient retries",
        {
          cycleId: state.cycleId,
          providerId,
          attempts: result.attempts,
          transientErrors: result.transientErrors,
        },
        {
          category: "queue",
          eventType: "queue_send_retry_recovered",
          cycleId: state.cycleId,
          providerId,
          phase: "enqueueNextChunk",
          statusKind: "running",
        },
      );
    }

    try {
      state.pendingSeq = state.nextSeq;
      state.pendingProviderId = providerId;
      state.pendingClaimedAt = null;
      state.pendingLeaseExpiresAt = this.pendingLeaseExpiresAt(now);
      state.nextSeq += 1;
      state.status = "running";
      state.wakeAt = null;
      state.lastEventAt = now;
      return await this.setAlarmSeconds(
        state,
        state.pendingLeaseExpiresAt,
        "enqueueNextChunk_pending_lease_alarm",
      );
    } catch (e) {
      await this.recordOrchestrationErrorFromCatch(state, e, "enqueueNextChunk");
      return false;
    }
  }

  /**
   * Fetch the effective daily cap and the UTC-day consumption counter for every
   * enabled provider. These feed the budget-balanced scheduler (see
   * `pickProviderByBudgetFill` in `providerRotation.ts`).
   *
   * Both reads are done in a single `Promise.all` so one pump tick costs ~1 D1 RTT
   * regardless of how many providers are enabled. The counters are the same ones
   * bumped by `rapidApiFetch` after each HTTP request, so this is the ground truth
   * for "how much of today's budget has this provider used?"
   */
  private async resolveProviderBudgets(
    enabled: readonly JobSourceId[],
    now: number,
  ): Promise<ProviderBudgetInfo[]> {
    const ymd = utcYmdFromUnix(now);
    return Promise.all(
      enabled.map(async (providerId) => {
        const [cap, consumed] = await Promise.all([
          getResolvedProviderDailyRequestCap(this.env.DB, this.env, this.userId, providerId),
          getProviderUtcDayRequestCount(this.env.DB, this.userId, providerId, ymd),
        ]);
        return { providerId, cap, consumed };
      }),
    );
  }

  private async pump(state: CoordinatorState, now: number): Promise<CoordinatorState> {
    try {
      const inactiveState = await this.pauseIfInactiveOwner(now);
      if (inactiveState) return inactiveState;

      let enabled: JobSourceId[];
      try {
        enabled = await this.enabledProviderIds();
      } catch (e) {
        await this.recordOrchestrationErrorFromCatch(state, e, "pump_enabledProviders");
        await this.saveState(state);
        return state;
      }

      if (!enabled.length) {
        state.status = "idle";
        state.wakeAt = null;
        this.clearPending(state);
        state.lastEventAt = now;
        state.orchestrationError = null;
        await this.setAlarmSeconds(state, null, "pump_idle_clearAlarm");
        await this.saveState(state);
        return state;
      }

      if (cycleNeedsUtcDayRollover(state.cycleId, now)) {
        state = await this.rolloverCycleForUtcBoundary(state, now, enabled);
      }

      let gate: Awaited<ReturnType<typeof getPipelineFetchAllowed>>;
      try {
        gate = await getPipelineFetchAllowed(this.env, this.userId);
      } catch (e) {
        await this.recordOrchestrationErrorFromCatch(state, e, "pump_gate");
        await this.saveState(state);
        return state;
      }

      if (!gate.allowed) {
        return this.applyBlockedFetchGate(state, gate, now, "pump_paused_gate_alarm");
      }

      if (state.cycleId && this.allEnabledProvidersDone(state, enabled)) {
        const wakeAt = this.nextCompletedCycleWakeAt(state, enabled, now);
        if (wakeAt <= now) {
          state = this.resetForNewCycle(state, now, enabled);
          await log.status(
            this.env,
            "orchestrator",
            "Starting new pipeline cycle",
            {
              userId: this.userId,
              cycleId: state.cycleId,
              providers: enabled,
              reason: "completed_cycle_wait_elapsed",
            },
            {
              userId: this.userId,
              category: "orchestration",
              eventType: "cycle_started",
              cycleId: state.cycleId,
              statusKind: "running",
            },
          );
        } else {
          state.wakeAt = wakeAt;
        }
      } else if (!state.cycleId) {
        state = this.resetForNewCycle(state, now, enabled);
        await log.status(
          this.env,
          "orchestrator",
          "Starting new pipeline cycle",
          {
            userId: this.userId,
            cycleId: state.cycleId,
            providers: enabled,
          },
          {
            userId: this.userId,
            category: "orchestration",
            eventType: "cycle_started",
            cycleId: state.cycleId,
            statusKind: "running",
          },
        );
      }
      observabilityLog(
        "debug",
        "orchestrator",
        "Pump state evaluated",
        {
          cycleId: state.cycleId,
          status: state.status,
          pendingSeq: state.pendingSeq,
          pendingProviderId: state.pendingProviderId,
          pendingClaimedAt: state.pendingClaimedAt,
          pendingLeaseExpiresAt: state.pendingLeaseExpiresAt,
          wakeAt: state.wakeAt,
          enabledProviders: enabled,
          providerStates: enabled.map((providerId) =>
            providerStateSnapshot(providerId, this.getProviderState(state, providerId)),
          ),
        },
        {
          category: "orchestration",
          eventType: "pump_state_evaluated",
          cycleId: state.cycleId,
          phase: "pump",
          statusKind: state.status === "idle" ? "paused" : state.status,
        },
      );

      if (state.pendingSeq != null) {
        const expired = !state.pendingLeaseExpiresAt || state.pendingLeaseExpiresAt <= now;
        if (expired) {
          await log.moderate(
            this.env,
            "orchestrator",
            "Pending provider chunk lease expired; releasing slot",
            {
              userId: this.userId,
              cycleId: state.cycleId,
              pendingSeq: state.pendingSeq,
              pendingProviderId: state.pendingProviderId,
              pendingClaimedAt: state.pendingClaimedAt,
              pendingLeaseExpiresAt: state.pendingLeaseExpiresAt,
            },
            {
              userId: this.userId,
              category: "queue",
              eventType: "pending_chunk_lease_expired",
              cycleId: state.cycleId,
              providerId: state.pendingProviderId,
              phase: "pump",
              statusKind: "degraded",
            },
          );
          this.clearPending(state);
          state.lastEventAt = now;
        } else {
          state.orchestrationError = null;
          await this.saveState(state);
          return state;
        }
      }

      let budgets: ProviderBudgetInfo[];
      try {
        budgets = await this.resolveProviderBudgets(enabled, now);
      } catch (e) {
        await this.recordOrchestrationErrorFromCatch(state, e, "pump_provider_budgets");
        await this.saveState(state);
        return state;
      }

      const runnableProviders: JobSourceId[] = [];
      let nextWake = 0;

      for (const providerId of enabled) {
        const providerState = this.getProviderState(state, providerId);
        if (providerState.doneForCycle) continue;
        if (providerState.nextEligibleAt > now) {
          if (nextWake === 0 || providerState.nextEligibleAt < nextWake) {
            nextWake = providerState.nextEligibleAt;
          }
          continue;
        }
        runnableProviders.push(providerId);
      }
      observabilityLog(
        "debug",
        "orchestrator",
        "Pump provider eligibility evaluated",
        {
          cycleId: state.cycleId,
          runnableProviders,
          nextWake,
          providerBudgets: budgets.map((b) => ({
            providerId: b.providerId,
            cap: b.cap,
            consumed: b.consumed,
            // Pre-compute for the log so operators can see the scheduler's current
            // view of each provider's UTC-day drain without recomputing the ratio.
            fill: b.cap > 0 ? b.consumed / b.cap : null,
          })),
          providerStates: enabled.map((providerId) =>
            providerStateSnapshot(providerId, this.getProviderState(state, providerId)),
          ),
        },
        {
          category: "orchestration",
          eventType: "pump_provider_eligibility_evaluated",
          cycleId: state.cycleId,
          phase: "pump",
          statusKind: runnableProviders.length > 0 ? "running" : "paused",
        },
      );

      const picked = pickProviderByBudgetFill(runnableProviders, budgets);
      const runnableProvider = picked.providerId ?? runnableProviders[0] ?? null;
      if (runnableProvider) {
        observabilityLog(
          "debug",
          "orchestrator",
          "Pump selected provider for next chunk",
          {
            cycleId: state.cycleId,
            providerId: runnableProvider,
            fillByProvider: picked.fillByProvider,
            pendingSeq: state.nextSeq,
          },
          {
            category: "queue",
            eventType: "pump_selected_provider",
            cycleId: state.cycleId,
            providerId: runnableProvider,
            phase: "pump",
            statusKind: "running",
          },
        );
        // `providerCurrentWeights` is legacy from the previous weighted-RR scheduler.
        // The budget-balanced picker is stateless (ground truth lives in the D1
        // counters, re-read every pump), so we just leave it empty. Keeping the
        // field in CoordinatorState avoids a breaking state-schema migration.
        state.providerCurrentWeights = {};
        const enq = await this.enqueueNextChunk(state, runnableProvider, now);
        if (!enq) {
          await this.saveState(state);
          return state;
        }
        await log.status(
          this.env,
          "orchestrator",
          "Queued provider chunk",
          {
            userId: this.userId,
            cycleId: state.cycleId,
            providerId: runnableProvider,
            seq: state.pendingSeq,
          },
          {
            userId: this.userId,
            category: "queue",
            eventType: "provider_chunk_queued",
            cycleId: state.cycleId,
            providerId: runnableProvider,
            statusKind: "running",
          },
        );
        state.orchestrationError = null;
        await this.saveState(state);
        return state;
      }

      state.providerCurrentWeights = {};

      if (this.allEnabledProvidersDone(state, enabled)) {
        const wakeAt = this.nextCompletedCycleWakeAt(state, enabled, now);
        state.status = "sleeping";
        state.wakeAt = wakeAt;
        state.lastEventAt = now;
        const alarmOk = await this.setAlarmSeconds(state, wakeAt, "pump_sleep_alarm");
        if (!alarmOk) {
          await this.saveState(state);
          return state;
        }
        state.orchestrationError = null;
        await log.status(
          this.env,
          "orchestrator",
          "All providers done for cycle; sleeping",
          {
            userId: this.userId,
            cycleId: state.cycleId,
            wakeAt,
            wakeAtIso: new Date(wakeAt * 1000).toISOString(),
          },
          {
            userId: this.userId,
            category: "orchestration",
            eventType: "cycle_sleeping",
            cycleId: state.cycleId,
            statusKind: "sleeping",
          },
        );
        await this.saveState(state);
        return state;
      }

      state.status = "running";
      state.wakeAt = nextWake || now + 60;
      state.lastEventAt = now;
      observabilityLog(
        "debug",
        "orchestrator",
        "Pump waiting for next eligible provider",
        {
          cycleId: state.cycleId,
          wakeAt: state.wakeAt,
          nextWake,
          providerStates: enabled.map((providerId) =>
            providerStateSnapshot(providerId, this.getProviderState(state, providerId)),
          ),
        },
        {
          category: "orchestration",
          eventType: "pump_waiting_for_provider",
          cycleId: state.cycleId,
          phase: "pump",
          statusKind: "paused",
        },
      );
      const alarmOk = await this.setAlarmSeconds(state, state.wakeAt, "pump_cooldown_alarm");
      if (!alarmOk) {
        await this.saveState(state);
        return state;
      }
      state.orchestrationError = null;
      await this.saveState(state);
      return state;
    } catch (e) {
      await this.recordOrchestrationErrorFromCatch(state, e, "pump");
      await this.saveState(state);
      return state;
    }
  }

  /**
   * After dashboard raises a vendor's daily RapidAPI cap, clear coordinator "done for cycle"
   * state that was only due to hitting that cap (`lastPauseKind === request_cap`), without
   * resetting D1 usage counters — {@link pump} may enqueue more chunks the same UTC day.
   */
  private async handleClearRequestCapPause(body: { providerIds?: unknown }): Promise<Response> {
    try {
      const now = Math.floor(Date.now() / 1000);
      const inactiveState = await this.pauseIfInactiveOwner(now);
      if (inactiveState) {
        return json({
          ok: true,
          cleared: 0,
          status: inactiveState.status,
          wakeAt: inactiveState.wakeAt,
        });
      }

      let state = await this.loadState();
      const rawIds = Array.isArray(body.providerIds) ? body.providerIds : [];
      const clearedIds: JobSourceId[] = [];
      for (const raw of rawIds) {
        if (typeof raw !== "string") continue;
        const providerId = raw as JobSourceId;
        const ps = this.getProviderState(state, providerId);
        if (ps.doneForCycle && ps.lastPauseKind === "request_cap") {
          state.providerStates[providerId] = {
            ...ps,
            doneForCycle: false,
            nextEligibleAt: 0,
            lastPauseKind: null,
          };
          clearedIds.push(providerId);
        }
      }
      if (!clearedIds.length) {
        return json({
          ok: true,
          cleared: 0,
          status: state.status,
          wakeAt: state.wakeAt,
        });
      }
      state.lastEventAt = now;
      state.orchestrationError = null;
      await log.low(
        this.env,
        "orchestrator",
        "Cleared request-cap pause (dashboard raised cap)",
        {
          userId: this.userId,
          providerIds: clearedIds,
        },
        {
          userId: this.userId,
          category: "dashboard",
          eventType: "request_cap_pause_cleared",
          phase: "clear_request_cap_pause",
          statusKind: "ok",
        },
      );
      state = await this.pump(state, now);
      return json({
        ok: true,
        cleared: clearedIds.length,
        status: state.status,
        wakeAt: state.wakeAt,
      });
    } catch (e) {
      let state = await this.loadState();
      await this.recordOrchestrationErrorFromCatch(state, e, "handleClearRequestCapPause");
      await this.saveState(state);
      return json({ ok: false, error: errMsg(e).slice(0, 500) }, 500);
    }
  }

  /**
   * Clears manual-resumable orchestration pauses without touching daily request counters.
   *
   * - `sources_exhausted`: reset the provider's persisted planner exhaustion state so it can rescan now.
   * - `schedule_wait`: clear LinkedIn freeze / other time-based "done for cycle" state.
   * - `request_cap`: intentionally left alone; use `/clear-request-cap-pause` or the dashboard limits reset.
   */
  private async handleClearExhaustPause(): Promise<Response> {
    try {
      const now = Math.floor(Date.now() / 1000);
      const inactiveState = await this.pauseIfInactiveOwner(now);
      if (inactiveState) {
        return json({
          ok: true,
          clearedProviders: 0,
          status: inactiveState.status,
          wakeAt: inactiveState.wakeAt,
          cycleId: inactiveState.cycleId,
        });
      }

      await setLinkedinFreezeUntil(this.env.DB, this.userId, 0, now);

      let state = await this.loadState();
      const enabled = await this.enabledProviderIds();
      let clearedProviders = 0;
      const plannerResetProviders: JobSourceId[] = [];

      for (const providerId of Object.keys(state.providerStates) as JobSourceId[]) {
        const ps = this.getProviderState(state, providerId);
        if (!ps.doneForCycle) continue;
        if (ps.lastPauseKind === "request_cap") continue;
        if (ps.lastPauseKind === "sources_exhausted") {
          await clearProviderExhaustionState(this.env.DB, this.userId, providerId, now);
          plannerResetProviders.push(providerId);
        }
        state.providerStates[providerId] = {
          ...ps,
          doneForCycle: false,
          nextEligibleAt: 0,
          lastPauseKind: null,
        };
        clearedProviders += 1;
      }

      state.lastEventAt = now;
      state.orchestrationError = null;
      if (state.status === "sleeping" && state.pendingSeq == null) {
        state.wakeAt = null;
        await this.setAlarmSeconds(state, null, "clear_exhaust_pause_clear_alarm");
      }

      state = await this.pump(state, now);

      await log.status(
        this.env,
        "orchestrator",
        "Exhaust / freeze pause cleared (manual)",
        {
          userId: this.userId,
          clearedProviders,
          plannerResetProviders,
          cycleId: state.cycleId,
          status: state.status,
          wakeAt: state.wakeAt,
          enabled,
        },
        {
          userId: this.userId,
          category: "orchestration",
          eventType: "exhaust_pause_cleared",
          cycleId: state.cycleId,
          phase: "clear_exhaust_pause",
          statusKind: "ok",
        },
      );

      return json({
        ok: true,
        clearedProviders,
        status: state.status,
        wakeAt: state.wakeAt,
        cycleId: state.cycleId,
      });
    } catch (e) {
      let state = await this.loadState();
      await this.recordOrchestrationErrorFromCatch(state, e, "handleClearExhaustPause");
      await this.saveState(state);
      return json({ ok: false, error: errMsg(e).slice(0, 500) }, 500);
    }
  }

  private async handleStart(body: { reason?: string }): Promise<Response> {
    try {
      const now = Math.floor(Date.now() / 1000);
      const inactiveState = await this.pauseIfInactiveOwner(now);
      if (inactiveState) {
        const out: CoordinatorStartResponse = {
          ok: true,
          started: false,
          status: inactiveState.status,
          cycleId: inactiveState.cycleId,
          wakeAt: inactiveState.wakeAt,
          note: "inactive_user",
        };
        return json(out);
      }

      const enabled = await this.enabledProviderIds();
      let state = await this.loadState();
      if (cycleNeedsUtcDayRollover(state.cycleId, now)) {
        state = await this.rolloverCycleForUtcBoundary(state, now, enabled);
      }
      const allDone = this.allEnabledProvidersDone(state, enabled);
      const completedWakeAt =
        state.cycleId && allDone ? this.nextCompletedCycleWakeAt(state, enabled, now) : null;
      if (
        state.cycleId &&
        state.status === "sleeping" &&
        completedWakeAt &&
        completedWakeAt > now &&
        allDone
      ) {
        if (state.wakeAt !== completedWakeAt) {
          state.wakeAt = completedWakeAt;
          state.lastEventAt = now;
          await this.setAlarmSeconds(state, completedWakeAt, "handleStart_refresh_sleep_alarm");
          await this.saveState(state);
        }
        const out: CoordinatorStartResponse = {
          ok: true,
          started: false,
          status: state.status,
          cycleId: state.cycleId,
          wakeAt: completedWakeAt,
          note: "sleeping_until_next_cycle",
        };
        return json(out);
      }

      if (allDone && (!completedWakeAt || completedWakeAt <= now)) {
        state = this.resetForNewCycle(state, now, enabled);
      } else if (!state.cycleId) {
        state = this.resetForNewCycle(state, now, enabled);
      }

      state = await this.pump(state, now);
      const out: CoordinatorStartResponse = {
        ok: true,
        started: true,
        status: state.status,
        cycleId: state.cycleId,
        wakeAt: state.wakeAt,
        note: body.reason,
      };
      return json(out);
    } catch (e) {
      let state = await this.loadState();
      await this.recordOrchestrationErrorFromCatch(state, e, "handleStart");
      await this.saveState(state);
      return json({
        ok: true,
        started: false,
        status: state.status,
        cycleId: state.cycleId,
        wakeAt: state.wakeAt,
        note: "orchestration_error",
      });
    }
  }

  private async handleGetStatus(): Promise<Response> {
    try {
      const now = Math.floor(Date.now() / 1000);
      const inactiveState = await this.pauseIfInactiveOwner(now);
      if (inactiveState) {
        const out: CoordinatorStatusResponse = {
          ok: true,
          status: inactiveState.status,
          wakeAt: inactiveState.wakeAt,
          cycleId: inactiveState.cycleId,
          pendingSeq: inactiveState.pendingSeq,
          pendingProviderId: inactiveState.pendingProviderId,
          orchestrationError: inactiveState.orchestrationError,
          lastEventAt: inactiveState.lastEventAt,
          providerOrchestration: {},
        };
        return json(out);
      }

      const state = await this.loadState();
      const providerOrchestration: CoordinatorStatusResponse["providerOrchestration"] = {};
      for (const id of Object.keys(state.providerStates) as JobSourceId[]) {
        const ps = this.getProviderState(state, id);
        providerOrchestration[id] = {
          doneForCycle: ps.doneForCycle,
          nextEligibleAt: ps.nextEligibleAt,
          lastPauseKind: ps.lastPauseKind ?? null,
        };
      }
      const persistedErr = state.orchestrationError;
      const errLooksLikeDeployNoise =
        persistedErr &&
        typeof persistedErr.message === "string" &&
        durableObjectDeployNoiseMessageText(persistedErr.message);
      if (errLooksLikeDeployNoise) {
        state.orchestrationError = null;
        await this.saveState(state);
      }
      const out: CoordinatorStatusResponse = {
        ok: true,
        status: state.status,
        wakeAt: state.wakeAt,
        cycleId: state.cycleId,
        pendingSeq: state.pendingSeq,
        pendingProviderId: state.pendingProviderId,
        orchestrationError: state.orchestrationError,
        lastEventAt: state.lastEventAt,
        providerOrchestration,
      };
      return json(out);
    } catch (e) {
      await log.moderate(
        this.env,
        "orchestrator",
        "Coordinator GET /status failed",
        { userId: this.userId, error: errMsg(e).slice(0, 500) },
        {
          userId: this.userId,
          category: "orchestration",
          eventType: "coordinator_status_failed",
          phase: "handleGetStatus",
          statusKind: "degraded",
        },
      );
      return json({ ok: false, error: "status_failed", message: errMsg(e).slice(0, 500) }, 500);
    }
  }

  private async handleOrchestrationErrorPost(body: { message?: string; phase?: string }): Promise<Response> {
    try {
      const now = Math.floor(Date.now() / 1000);
      const inactiveState = await this.pauseIfInactiveOwner(now);
      if (inactiveState) return json({ ok: true });

      const state = await this.loadState();
      const msg = String(body.message ?? "unknown").slice(0, 2000);
      const phase = String(body.phase ?? "external").slice(0, 200);
      state.orchestrationError = { message: msg, at: now, phase };
      state.lastEventAt = now;
      await this.saveState(state);
      await log.critical(
        this.env,
        "orchestrator",
        "Orchestration error (external)",
        {
          userId: this.userId,
          phase,
          message: msg.slice(0, 500),
        },
        {
          userId: this.userId,
          category: "orchestration",
          eventType: "orchestration_error_external",
          cycleId: state.cycleId,
          phase,
          statusKind: "failed",
        },
      );
      return json({ ok: true });
    } catch (e) {
      await log.moderate(
        this.env,
        "orchestrator",
        "Persist external orchestration error failed",
        { userId: this.userId, error: errMsg(e).slice(0, 500) },
        {
          userId: this.userId,
          category: "orchestration",
          eventType: "orchestration_error_post_persist_failed",
          phase: "handleOrchestrationErrorPost",
          statusKind: "degraded",
        },
      );
      return json({ ok: false, error: errMsg(e).slice(0, 500) }, 500);
    }
  }

  private async handleResetInactiveUser(): Promise<Response> {
    const now = Math.floor(Date.now() / 1000);
    const state = await this.resetInactiveUserState(now);
    return json({ ok: true, status: state.status, cleared: true });
  }

  private async handleClaim(body: {
    cycleId?: string;
    seq?: number;
    providerId?: JobSourceId;
  }): Promise<Response> {
    try {
      const now = Math.floor(Date.now() / 1000);
      const inactiveState = await this.pauseIfInactiveOwner(now);
      if (inactiveState) {
        const out: CoordinatorClaimResponse = { ok: true, execute: false, reason: "inactive_user" };
        return json(out);
      }

      const state = await this.loadState();
      let gate: Awaited<ReturnType<typeof getPipelineFetchAllowed>>;
      try {
        gate = await getPipelineFetchAllowed(this.env, this.userId);
      } catch (e) {
        await this.recordOrchestrationErrorFromCatch(state, e, "handleClaim_gate");
        await this.saveState(state);
        return json({ ok: true, execute: false, reason: "orchestration_error" });
      }
      if (!gate.allowed) {
        if (
          state.cycleId === body.cycleId &&
          state.pendingSeq === body.seq &&
          state.pendingProviderId === body.providerId
        ) {
          await this.applyBlockedFetchGate(
            state,
            gate,
            Math.floor(Date.now() / 1000),
            "handleClaim_paused_gate_alarm",
          );
        }
        const out: CoordinatorClaimResponse = { ok: true, execute: false, reason: gate.reason };
        return json(out);
      }
      if (
        !body.cycleId ||
        typeof body.seq !== "number" ||
        !body.providerId ||
        state.cycleId !== body.cycleId ||
        state.pendingSeq !== body.seq ||
        state.pendingProviderId !== body.providerId
      ) {
        const out: CoordinatorClaimResponse = { ok: true, execute: false, reason: "stale_message" };
        return json(out);
      }
      // Reaching here means cycleId/seq/providerId all match the coordinator's currently pending
      // slot. If `pendingClaimedAt` is already set, this /claim must be a Queue redelivery of the
      // same message (the consumer only calls /claim once per delivery, and /report advances
      // pendingSeq so a later message for the same seq would already trip the stale guard above).
      // Redelivery happens when the previous invocation didn't ack — typically a worker cancel
      // during deploys / timeouts. Rejecting redelivery here used to leave the slot stuck for the
      // full lease window; instead we treat it as a re-claim and let the consumer run again.
      // Safety: runProviderChunk is idempotent at the data layer (content-hash dedupe in
      // processFetchedJobs), handleReport rejects reports for a cycle/seq/providerId that's no
      // longer pending, and the Queue's own max_retries bounds the blast radius of a persistently
      // failing chunk.
      const isReclaim = state.pendingClaimedAt != null;
      if (isReclaim) {
        await log.status(
          this.env,
          "orchestrator",
          "Re-claiming pending provider chunk after queue redelivery",
          {
            userId: this.userId,
            cycleId: body.cycleId,
            seq: body.seq,
            providerId: body.providerId,
            previousClaimedAt: state.pendingClaimedAt,
            previousLeaseExpiresAt: state.pendingLeaseExpiresAt,
          },
          {
            userId: this.userId,
            category: "queue",
            eventType: "pending_chunk_reclaimed",
            cycleId: body.cycleId,
            providerId: body.providerId,
            phase: "handleClaim",
            statusKind: "degraded",
          },
        );
      }
      state.pendingClaimedAt = now;
      state.pendingLeaseExpiresAt = this.pendingLeaseExpiresAt(now);
      state.lastEventAt = now;
      await this.setAlarmSeconds(state, state.pendingLeaseExpiresAt, "handleClaim_pending_lease_alarm");
      await this.saveState(state);
      const out: CoordinatorClaimResponse = { ok: true, execute: true };
      return json(out);
    } catch (e) {
      let state = await this.loadState();
      await this.recordOrchestrationErrorFromCatch(state, e, "handleClaim");
      await this.saveState(state);
      return json({ ok: true, execute: false, reason: "orchestration_error" });
    }
  }

  private async handleHeartbeat(body: {
    cycleId?: string;
    seq?: number;
    providerId?: JobSourceId;
    stage?: string;
  }): Promise<Response> {
    try {
      const now = Math.floor(Date.now() / 1000);
      const inactiveState = await this.pauseIfInactiveOwner(now);
      if (inactiveState) {
        const out: CoordinatorHeartbeatResponse = {
          ok: true,
          extended: false,
          leaseExpiresAt: inactiveState.pendingLeaseExpiresAt,
          reason: "inactive_user",
        };
        return json(out);
      }

      const state = await this.loadState();
      if (
        !body.cycleId ||
        typeof body.seq !== "number" ||
        !body.providerId ||
        state.cycleId !== body.cycleId ||
        state.pendingSeq !== body.seq ||
        state.pendingProviderId !== body.providerId
      ) {
        const out: CoordinatorHeartbeatResponse = {
          ok: true,
          extended: false,
          leaseExpiresAt: state.pendingLeaseExpiresAt,
          reason: "stale_message",
        };
        return json(out);
      }
      if (state.pendingClaimedAt == null) {
        const out: CoordinatorHeartbeatResponse = {
          ok: true,
          extended: false,
          leaseExpiresAt: state.pendingLeaseExpiresAt,
          reason: "not_claimed",
        };
        return json(out);
      }
      state.pendingLeaseExpiresAt = this.pendingLeaseExpiresAt(now);
      state.lastEventAt = now;
      await this.setAlarmSeconds(state, state.pendingLeaseExpiresAt, "handleHeartbeat_pending_lease_alarm");
      await this.saveState(state);
      const out: CoordinatorHeartbeatResponse = {
        ok: true,
        extended: true,
        leaseExpiresAt: state.pendingLeaseExpiresAt,
      };
      return json(out);
    } catch (e) {
      let state = await this.loadState();
      await this.recordOrchestrationErrorFromCatch(state, e, "handleHeartbeat");
      await this.saveState(state);
      const out: CoordinatorHeartbeatResponse = {
        ok: true,
        extended: false,
        leaseExpiresAt: state.pendingLeaseExpiresAt,
        reason: "orchestration_error",
      };
      return json(out);
    }
  }

  private async handleDedupe(body: { cycleId?: string; keys?: string[] }): Promise<Response> {
    try {
      const inactiveState = await this.pauseIfInactiveOwner(Math.floor(Date.now() / 1000));
      if (inactiveState) {
        const keys = Array.isArray(body.keys) ? body.keys : [];
        const out: CoordinatorDedupeResponse = { ok: true, keep: keys.map(() => false) };
        return json(out);
      }

      const state = await this.loadState();
      const keys = Array.isArray(body.keys) ? body.keys : [];
      const keep: boolean[] = [];
      if (!body.cycleId || state.cycleId !== body.cycleId) {
        for (let i = 0; i < keys.length; i++) keep.push(false);
        const out: CoordinatorDedupeResponse = { ok: true, keep };
        return json(out);
      }

      const seen = new Set(state.seenDedupeKeys);
      for (const key of keys) {
        if (!key || seen.has(key)) {
          keep.push(false);
          continue;
        }
        seen.add(key);
        keep.push(true);
      }
      state.seenDedupeKeys = [...seen];
      state.lastEventAt = Math.floor(Date.now() / 1000);
      await this.saveState(state);

      const out: CoordinatorDedupeResponse = { ok: true, keep };
      return json(out);
    } catch (e) {
      let state = await this.loadState();
      await this.recordOrchestrationErrorFromCatch(state, e, "handleDedupe");
      await this.saveState(state);
      return json({ ok: true, keep: (Array.isArray(body.keys) ? body.keys : []).map(() => false) });
    }
  }

  private async handleReport(body: ProviderChunkReport): Promise<Response> {
    const now = Math.floor(Date.now() / 1000);
    try {
      const inactiveState = await this.pauseIfInactiveOwner(now);
      if (inactiveState) {
        const out: CoordinatorReportResponse = {
          ok: true,
          status: inactiveState.status,
          wakeAt: inactiveState.wakeAt,
        };
        return json(out);
      }

      let state = await this.loadState();
      if (
        !body.cycleId ||
        state.cycleId !== body.cycleId ||
        state.pendingSeq !== body.seq ||
        state.pendingProviderId !== body.providerId
      ) {
        const stale: CoordinatorReportResponse = {
          ok: true,
          status: state.status,
          wakeAt: state.wakeAt,
        };
        return json(stale);
      }

      const providerState = this.getProviderState(state, body.providerId);
      providerState.doneForCycle = body.providerResult.doneForCycle;
      providerState.nextEligibleAt =
        body.providerResult.nextEligibleAt ??
        (body.providerResult.doneForCycle ? nextUtcMidnightUnix(now) : now);
      providerState.lastPauseKind = body.providerResult.doneForCycle
        ? deriveProviderPauseKind(body.providerResult.meta, true)
        : null;
      providerState.lastError =
        body.processing.errors.length > 0 ? body.processing.errors[body.processing.errors.length - 1]! : null;
      providerState.consecutiveErrors = providerState.lastError
        ? providerState.consecutiveErrors + 1
        : 0;
      state.providerStates[body.providerId] = providerState;
      observabilityLog(
        "debug",
        "orchestrator",
        "Applied provider chunk report to coordinator state",
        {
          cycleId: body.cycleId,
          providerId: body.providerId,
          seq: body.seq,
          providerResult: body.providerResult,
          processing: {
            fetched: body.processing.fetched,
            kept: body.processing.kept,
            processed: body.processing.processed,
            skipped: body.processing.skipped,
            errorCount: body.processing.errors.length,
          },
          providerState: providerStateSnapshot(body.providerId, providerState),
        },
        {
          category: "orchestration",
          eventType: "provider_chunk_report_applied",
          cycleId: body.cycleId,
          providerId: body.providerId,
          phase: "handleReport",
          statusKind: providerState.lastError ? "degraded" : providerState.doneForCycle ? "sleeping" : "ok",
        },
      );
      if (providerState.doneForCycle && providerState.lastPauseKind === "vendor_quota") {
        await log.moderate(
          this.env,
          "orchestrator",
          "Vendor quota exhausted; provider paused until next cycle window",
          {
            userId: this.userId,
            cycleId: body.cycleId,
            providerId: body.providerId,
            seq: body.seq,
            nextEligibleAt: providerState.nextEligibleAt,
            meta: body.providerResult.meta ?? null,
          },
          {
            userId: this.userId,
            category: "vendor",
            eventType: "provider_vendor_quota_exhausted",
            cycleId: body.cycleId,
            providerId: body.providerId,
            phase: "handleReport",
            statusKind: "degraded",
            fingerprint: `provider_vendor_quota_exhausted|${body.providerId}`,
          },
        );
      }
      this.clearPending(state);
      state.lastEventAt = now;

      await log.status(
        this.env,
        "orchestrator",
        "Provider chunk finished",
        {
          userId: this.userId,
          cycleId: body.cycleId,
          providerId: body.providerId,
          seq: body.seq,
          providerResult: body.providerResult,
          processing: body.processing,
        },
        {
          userId: this.userId,
          category: "queue",
          eventType: "provider_chunk_finished",
          cycleId: body.cycleId,
          providerId: body.providerId,
          statusKind: body.processing.errors.length > 0 ? "degraded" : "ok",
        },
      );

      state = await this.pump(state, now);
      const out: CoordinatorReportResponse = {
        ok: true,
        status: state.status,
        wakeAt: state.wakeAt,
      };
      return json(out);
    } catch (e) {
      let state = await this.loadState();
      await this.recordOrchestrationErrorFromCatch(state, e, "handleReport");
      await this.saveState(state);
      return json({
        ok: true,
        status: state.status,
        wakeAt: state.wakeAt,
      });
    }
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    let body: unknown = {};
    if (request.method === "POST") {
      try {
        body = await request.json();
      } catch {
        body = {};
      }
    }

    try {
      if (request.method === "GET" && url.pathname === "/status") {
        return this.handleGetStatus();
      }
      if (request.method === "POST" && url.pathname === "/orchestration-error") {
        return this.handleOrchestrationErrorPost((body ?? {}) as { message?: string; phase?: string });
      }
      if (
        request.method === "POST" &&
        (url.pathname === "/reset-inactive-user" || url.pathname === "/reset-deleted-user")
      ) {
        return this.handleResetInactiveUser();
      }
      if (request.method === "POST" && url.pathname === "/start") {
        return this.handleStart((body ?? {}) as { reason?: string });
      }
      if (request.method === "POST" && url.pathname === "/clear-request-cap-pause") {
        return this.handleClearRequestCapPause((body ?? {}) as { providerIds?: unknown });
      }
      if (request.method === "POST" && url.pathname === "/clear-exhaust-pause") {
        return this.handleClearExhaustPause();
      }
      if (request.method === "POST" && url.pathname === "/claim") {
        return this.handleClaim((body ?? {}) as { cycleId?: string; seq?: number; providerId?: JobSourceId });
      }
      if (request.method === "POST" && url.pathname === "/heartbeat") {
        return this.handleHeartbeat(
          (body ?? {}) as { cycleId?: string; seq?: number; providerId?: JobSourceId; stage?: string },
        );
      }
      if (request.method === "POST" && url.pathname === "/dedupe") {
        return this.handleDedupe((body ?? {}) as { cycleId?: string; keys?: string[] });
      }
      if (request.method === "POST" && url.pathname === "/report") {
        return this.handleReport((body ?? {}) as ProviderChunkReport);
      }
      return json({ ok: false, error: "not_found" }, 404);
    } catch (e) {
      await log.critical(
        this.env,
        "orchestrator",
        "Coordinator fetch handler threw",
        {
          userId: this.userId,
          pathname: url.pathname,
          method: request.method,
          error: errMsg(e).slice(0, 500),
        },
        {
          userId: this.userId,
          category: "orchestration",
          eventType: "coordinator_fetch_failed",
          phase: url.pathname,
          statusKind: "failed",
        },
      );
      return json({ ok: false, error: "do_fetch_failed", message: errMsg(e).slice(0, 500) }, 500);
    }
  }

  async alarm(): Promise<void> {
    try {
      const now = Math.floor(Date.now() / 1000);
      const inactiveState = await this.pauseIfInactiveOwner(now);
      if (inactiveState) return;

      let state = await this.loadState();
      const enabled = await this.enabledProviderIds();
      if (this.allEnabledProvidersDone(state, enabled) && state.wakeAt && state.wakeAt <= now) {
        state = this.resetForNewCycle(state, now, enabled);
        await log.status(
          this.env,
          "orchestrator",
          "Alarm woke coordinator for a new cycle",
          {
            userId: this.userId,
            cycleId: state.cycleId,
          },
          {
            userId: this.userId,
            category: "orchestration",
            eventType: "alarm_cycle_started",
            cycleId: state.cycleId,
            statusKind: "running",
          },
        );
      }
      await this.pump(state, now);
    } catch (e) {
      let state = await this.loadState();
      await this.recordOrchestrationErrorFromCatch(state, e, "alarm");
      await this.saveState(state);
    }
  }
}
