/**
 * Best-effort posted date from LinkedIn Fantastic Jobs / JSearch raw job objects.
 * Returns Unix seconds UTC, or undefined if not parseable.
 */
export function parsePostedAtUnixSeconds(raw: Record<string, unknown>): number | undefined {
  const ts = raw.job_posted_at_timestamp;
  if (typeof ts === "number" && Number.isFinite(ts)) {
    return ts > 1e12 ? Math.floor(ts / 1000) : Math.floor(ts);
  }

  const keys = [
    "date_posted",
    "date_created",
    "job_posted_at_datetime_utc",
    "job_posted_at",
    "job_posted_at_datetime",
  ] as const;

  for (const key of keys) {
    const v = raw[key];
    if (typeof v !== "string") continue;
    const s = v.trim();
    if (!s) continue;
    const ms = Date.parse(s);
    if (!Number.isNaN(ms)) return Math.floor(ms / 1000);
  }

  return undefined;
}
