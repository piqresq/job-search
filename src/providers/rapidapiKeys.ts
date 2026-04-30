/**
 * Resolve the RapidAPI key from env: `RAPIDAPI_KEYS` (comma or newline separated) or `RAPIDAPI_KEY`.
 * Only the **first** key is used; extra entries are ignored (no rotation).
 */
export function parseRapidApiKeys(env: Env): string[] {
  const multi = env.RAPIDAPI_KEYS?.trim();
  if (multi) {
    const keys = multi
      .split(/[\n,]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (keys.length) return [keys[0]!];
  }
  const single = env.RAPIDAPI_KEY?.trim();
  if (single) return [single];
  return [];
}
