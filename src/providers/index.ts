import { getEnabledJobSourceIdsFromDb } from "../db/appSettings";
import { jobsApiProvider } from "./jobsApi";
import { jsearchProvider } from "./jsearch";
import { linkedinJobsProvider } from "./linkedinJobs";
import type { JobSourceProvider } from "./types";
import type { JobSourceId } from "../types/job";

const registry: JobSourceProvider[] = [linkedinJobsProvider, jsearchProvider, jobsApiProvider];

export function getRegisteredProviderIds(): JobSourceId[] {
  return registry.map((p) => p.id);
}

/** Pipeline provider order — used as the stable tie-break order for weighted coordinator rotation. */
export async function getEnabledProviders(env: Env, userId: string): Promise<JobSourceProvider[]> {
  const ids = await getEnabledJobSourceIdsFromDb(env.DB, userId, getRegisteredProviderIds());
  if (ids.length === 0) {
    return [];
  }
  const set = new Set(ids);
  return registry.filter((p) => set.has(p.id));
}

export function getProviderById(id: JobSourceId): JobSourceProvider | null {
  return registry.find((p) => p.id === id) ?? null;
}

export { jobsApiProvider, jsearchProvider, linkedinJobsProvider };
