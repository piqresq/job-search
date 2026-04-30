import type { JobSourceId, NormalizedJob } from "../types/job";

export type FetchJobsParams = {
  query?: string;
  page?: number;
  pageSize?: number;
  cycleId?: string;
};

export type ProviderChunkResult = {
  jobs: NormalizedJob[];
  /** More work remains for this provider in the current logical cycle. */
  more: boolean;
  /** Provider is done for the current logical cycle and should wait for the next cycle. */
  doneForCycle: boolean;
  /**
   * Optional earliest time (unix seconds) when this provider should be revisited.
   * Used for short backoff / spacing as well as provider-specific freeze windows.
   */
  nextEligibleAt?: number;
  meta?: Record<string, unknown>;
};

export type JobSourceProvider = {
  readonly id: JobSourceId;
  fetchChunk(env: Env, params: FetchJobsParams): Promise<ProviderChunkResult>;
};
