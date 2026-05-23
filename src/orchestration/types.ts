import type { JobSourceId } from "../types/job";
import type { ProviderPauseKind } from "./providerPauseKind";

export type PipelineQueueMessage = {
  kind: "provider_chunk";
  userId: string;
  cycleId: string;
  seq: number;
  providerId: JobSourceId;
  requestedAt: number;
};

export type PipelineStatus = "idle" | "running" | "paused" | "sleeping";

export type ProviderCycleState = {
  doneForCycle: boolean;
  nextEligibleAt: number;
  consecutiveErrors: number;
  lastError: string | null;
  /** Set when the last completed chunk had `doneForCycle` (from provider `meta`). */
  lastPauseKind: ProviderPauseKind | null;
};

/** Set when DO / queue / alarm logic fails — not provider API errors. */
export type OrchestrationError = {
  message: string;
  at: number;
  phase: string;
};

export type CoordinatorState = {
  cycleId: string | null;
  status: PipelineStatus;
  providerCurrentWeights: Partial<Record<JobSourceId, number>>;
  nextSeq: number;
  pendingSeq: number | null;
  pendingProviderId: JobSourceId | null;
  /** Set by `/claim` on the first accepted delivery attempt for the current pending message. */
  pendingClaimedAt: number | null;
  /** Safety lease so a lost queue message cannot wedge the coordinator forever. */
  pendingLeaseExpiresAt: number | null;
  wakeAt: number | null;
  lastEventAt: number;
  providerStates: Partial<Record<JobSourceId, ProviderCycleState>>;
  seenDedupeKeys: string[];
  orchestrationError: OrchestrationError | null;
};

export type ProviderOrchestrationSnapshot = {
  doneForCycle: boolean;
  nextEligibleAt: number;
  lastPauseKind: ProviderPauseKind | null;
};

export type CoordinatorStatusResponse = {
  ok: true;
  status: PipelineStatus;
  wakeAt: number | null;
  cycleId: string | null;
  pendingSeq: number | null;
  pendingProviderId: JobSourceId | null;
  orchestrationError: OrchestrationError | null;
  lastEventAt: number;
  /** Per-provider orchestration snapshot (only keys that have reported at least once). */
  providerOrchestration: Partial<Record<JobSourceId, ProviderOrchestrationSnapshot>>;
};

export type CoordinatorStartResponse = {
  ok: true;
  started: boolean;
  status: PipelineStatus;
  cycleId: string | null;
  wakeAt: number | null;
  note?: string;
};

export type CoordinatorClaimResponse = {
  ok: true;
  execute: boolean;
  reason?: string;
};

export type CoordinatorHeartbeatResponse = {
  ok: true;
  extended: boolean;
  leaseExpiresAt: number | null;
  reason?: string;
};

export type CoordinatorDedupeResponse = {
  ok: true;
  keep: boolean[];
};

export type CoordinatorReportResponse = {
  ok: true;
  status: PipelineStatus;
  wakeAt: number | null;
};

export type CoordinatorResetResponse = {
  ok: true;
  status: PipelineStatus;
  cleared: boolean;
};

export type ProviderChunkReport = {
  cycleId: string;
  seq: number;
  providerId: JobSourceId;
  providerResult: {
    more: boolean;
    doneForCycle: boolean;
    nextEligibleAt?: number;
    meta?: Record<string, unknown>;
  };
  processing: {
    fetched: number;
    kept: number;
    processed: number;
    skipped: number;
    errors: string[];
  };
};
