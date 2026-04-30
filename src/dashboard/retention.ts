import { deleteJobsByIdsWithR2Cleanup, selectExpiredDashboardJobs } from "../db/jobs";

export async function purgeExpiredDashboardJobs(env: Env, now: number): Promise<{
  deletedJobs: number;
  r2Deleted: number;
}> {
  const ids = await selectExpiredDashboardJobs(env.DB, now);
  if (ids.length === 0) return { deletedJobs: 0, r2Deleted: 0 };

  const { r2Deleted } = await deleteJobsByIdsWithR2Cleanup(env.DB, env.DOCS_BUCKET, ids);
  return { deletedJobs: ids.length, r2Deleted };
}
