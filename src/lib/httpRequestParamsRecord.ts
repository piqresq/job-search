/**
 * Flat records persisted on `NormalizedJob.ingestionRequestParams` for dashboard
 * "Pipeline & extraction" — only HTTP request facts (not API response fields).
 */

export function flatHttpGetRequestRecord(
  url: URL,
  opts?: { host?: string; keyPrefix?: string },
): Record<string, string | number | boolean> {
  const p = opts?.keyPrefix ?? "";
  const out: Record<string, string | number | boolean> = {};
  out[p + "method"] = "GET";
  if (opts?.host) out[p + "host"] = opts.host;
  out[p + "path"] = url.pathname;
  url.searchParams.forEach((v, k) => {
    out[p + k] = v;
  });
  return out;
}

export function mergeRequestParamRecords(
  ...parts: Array<Record<string, string | number | boolean> | undefined>
): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const part of parts) {
    if (!part) continue;
    Object.assign(out, part);
  }
  return out;
}
