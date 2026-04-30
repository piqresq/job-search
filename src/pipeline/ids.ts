import type { JobSourceId } from "../types/job";

export async function stableJobId(source: JobSourceId, externalId: string): Promise<string> {
  const enc = new TextEncoder().encode(`${source}:${externalId}`);
  const buf = await crypto.subtle.digest("SHA-256", enc);
  const hex = [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return hex.slice(0, 32);
}
