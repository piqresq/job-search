/**
 * Lexical normalization for deterministic matching (both query and title).
 */

const WS = /\s+/g;

/** Collapse repeated whitespace after other steps. */
export function collapseWs(s: string): string {
  return s.replace(WS, " ").trim();
}

/**
 * Lowercase, trim, collapse whitespace, replace punctuation with spaces,
 * strip bracket/parenthetical segments that are noise-only.
 */
export function normalizeRoleText(raw: string, extraNoise?: ReadonlySet<string>): string {
  let s = raw.normalize("NFKC").toLowerCase();
  s = s.replace(/\(([^)]*)\)/g, (_m, inner: string) => {
    const t = collapseWs(String(inner).replace(/[^\p{L}\p{N}\s]+/gu, " "));
    const tokens = t.split(" ").filter(Boolean);
    if (tokens.length === 0) return " ";
    const noise = mergeNoise(extraNoise);
    const allNoise = tokens.every((w) => noise.has(w) || w.length <= 1);
    return allNoise ? " " : ` ${t} `;
  });
  s = s.replace(/\[[^\]]*]/g, " ");
  s = collapseWs(
    s
      .replace(/[/|,&]+/g, " ")
      .replace(/[–—\-_.;:]+/g, " ")
      .replace(/[^\p{L}\p{N}\s]+/gu, " "),
  );
  /** FP&A and similar surface as "fp a" after punctuation split — fold to one finance token. */
  s = collapseWs(s.replace(/\bfp\s+a\b/gu, "fpa"));
  return collapseWs(s);
}

function mergeNoise(extra?: ReadonlySet<string>): Set<string> {
  const out = new Set(NOISE_FOR_PAREN_STRIP);
  if (extra) for (const x of extra) out.add(x);
  return out;
}

/** Minimal noise used to decide if a parenthetical is fluff-only. */
const NOISE_FOR_PAREN_STRIP = new Set<string>([
  "remote",
  "hybrid",
  "full",
  "time",
  "contract",
  "eastern",
  "europe",
  "emea",
  "germany",
  "italy",
  "milan",
  "united",
  "states",
  "usa",
  "uk",
  "mfd",
  "all",
  "genders",
]);

export function tokenizeNormalized(normalized: string): string[] {
  return normalized.split(" ").filter(Boolean);
}
