import type { NormalizedJob } from "../types/job";

export function dedupeKey(j: NormalizedJob): string {
  const u = (j.applyUrl || j.jobUrl || "").toLowerCase().split("?")[0];
  if (u) return `url:${u}`;
  return `fallback:${j.company.toLowerCase()}|${j.title.toLowerCase()}`;
}

export function dedupeJobs(jobs: NormalizedJob[]): NormalizedJob[] {
  const seen = new Set<string>();
  const out: NormalizedJob[] = [];
  for (const j of jobs) {
    const k = dedupeKey(j);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(j);
  }
  return out;
}
