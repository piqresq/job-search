/** Unix seconds at the start of the next UTC calendar day (00:00:00). */
export function nextUtcMidnightUnix(nowSec: number): number {
  const now = new Date(nowSec * 1000);
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1) / 1000;
}
