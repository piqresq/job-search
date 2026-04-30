export function includeEveryNCycles(cycleId: string, everyN: number): boolean {
  const n = Math.max(2, Math.floor(everyN));
  let hash = 0;
  for (let i = 0; i < cycleId.length; i++) {
    hash = (hash * 31 + cycleId.charCodeAt(i)) >>> 0;
  }
  return hash % n === 0;
}
