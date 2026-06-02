import { normalizeEmploymentMatchKey } from "./employmentTypeCanonical";
import type { NormalizedJob } from "../../types/job";

/** Stored on `NormalizedJob.workplaceType` and shown in the dashboard. */
export type CanonicalWorkplaceType = "Office" | "Remote" | "Hybrid";

type WpBucket = "hybrid" | "remote" | "office";

const LABELS: Record<WpBucket, CanonicalWorkplaceType> = {
  hybrid: "Hybrid",
  remote: "Remote",
  office: "Office",
};

/** Longest / most specific phrases first (hybrid before remote before office). */
const PHRASES: ReadonlyArray<{ bucket: WpBucket; needles: readonly string[] }> = [
  {
    bucket: "hybrid",
    needles: [
      "hybrid",
      "hybrid work",
      "hybrid role",
      "hybrid model",
      "remote & office",
      "remote and office",
      "office & remote",
      "office and remote",
      "remote / office",
      "office / remote",
      "teilweise remote",
      "teilweise im büro",
      "teilweise im buro",
      "hybride arbeit",
      "hybridarbeit",
      "travail hybride",
      "modèle hybride",
      "modele hybride",
      "présentiel et télétravail",
      "presentiel et teletravail",
      "on-site and remote",
      "onsite and remote",
    ],
  },
  {
    bucket: "remote",
    needles: [
      "fully remote",
      "100% remote",
      "full remote",
      "work from home",
      "work-from-home",
      "wfh",
      "telecommute",
      "teletravail",
      "télétravail",
      "remote-first",
      "remote first",
      "remote role",
      "remote position",
      "remote job",
      "entirely remote",
      "completely remote",
      "anywhere in",
      "from anywhere",
      "distributed team",
      "vollständig remote",
      "voll remote",
      "100 % remote",
      "remote arbeit",
      "remote-arbeit",
      "home office",
      "homeoffice",
      "travail à distance",
      "travail a distance",
      "remote only",
    ],
  },
  {
    bucket: "office",
    needles: [
      "on-site",
      "onsite",
      "on site",
      "in office",
      "in the office",
      "office-based",
      "office based",
      "100% on-site",
      "100% onsite",
      "office presence",
      "am standort",
      "im büro",
      "im buro",
      "vor ort",
      "présentiel",
      "presentiel",
      "sur site",
      "on premise",
      "on-premises",
    ],
  },
];

export function canonicalizeWorkplaceFromText(raw: string | undefined | null): CanonicalWorkplaceType | null {
  const key = normalizeEmploymentMatchKey(String(raw ?? ""));
  if (!key) return null;
  for (const { bucket, needles } of PHRASES) {
    for (const n of needles) {
      if (key.includes(normalizeEmploymentMatchKey(n))) return LABELS[bucket];
    }
  }
  return null;
}

function bucketForCanonicalWorkplaceType(t: CanonicalWorkplaceType): WpBucket {
  if (t === "Remote") return "remote";
  if (t === "Hybrid") return "hybrid";
  return "office";
}

function remoteBareTokenInText(key: string): boolean {
  if (!/\bremote\b/.test(key)) return false;
  if (/\bnot\s+remote\b/.test(key)) return false;
  if (/\bno\s+remote\b/.test(key)) return false;
  if (/\bnon[\s-]*remote\b/.test(key)) return false;
  return true;
}

/**
 * True when a blob of page HTML/text contains signals for the expected workplace type.
 * Uses the same PHRASES table as {@link canonicalizeWorkplaceFromText}, plus bare
 * "remote" / "telecommute" for LinkedIn listing JSON (with negation guard for remote).
 */
export function textConfirmsWorkplaceType(
  text: string,
  expected: CanonicalWorkplaceType,
): boolean {
  const key = normalizeEmploymentMatchKey(text);
  if (!key) return false;
  const bucket = bucketForCanonicalWorkplaceType(expected);
  for (const { bucket: b, needles } of PHRASES) {
    if (b !== bucket) continue;
    for (const n of needles) {
      if (key.includes(normalizeEmploymentMatchKey(n))) return true;
    }
  }
  if (expected === "Remote") {
    if (key.includes("telecommute")) return true;
    if (remoteBareTokenInText(key)) return true;
  }
  return false;
}

/** Normalize text for lightweight title / parenthetical workplace tokens (not full PHRASES scan). */
function compactWpKey(s: string): string {
  return normalizeEmploymentMatchKey(s)
    .replace(/[()]/g, " ")
    .replace(/[/|]+/g, " ")
    .replace(/[-\u2010-\u2015\u2212\uFE58\uFE63\uFF0D]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Classify a short phrase (e.g. parenthetical in a job title) as Office | Remote | Hybrid.
 * Order: hybrid, remote-style (before bare "office" so "home office" → Remote), then on-site / office.
 */
function classifyShortWorkplacePhrase(s: string): CanonicalWorkplaceType | null {
  const k = compactWpKey(s);
  if (!k) return null;
  if (k.includes("hybrid")) return "Hybrid";
  const looksNegatedRemote = /\bnot\s+remote\b/.test(k) || /\bno\s+remote\b/.test(k) || /\bnon[\s-]*remote\b/.test(k);
  if (
    !looksNegatedRemote &&
    (k.includes("home office") ||
      k.includes("homeoffice") ||
      k.includes("work from home") ||
      k.includes("wfh") ||
      k.includes("remote") ||
      k.includes("teletravail") ||
      k.includes("télétravail") ||
      k.includes("distributed"))
  ) {
    return "Remote";
  }
  if (
    k.includes("on site") ||
    k.includes("onsite") ||
    k.includes("on premise") ||
    k.includes("on premises") ||
    k.includes("presentiel") ||
    k.includes("vor ort") ||
    k.includes("im buro") ||
    k.includes("im büro") ||
    /\boffice\b/.test(k)
  ) {
    return "Office";
  }
  return null;
}

/**
 * Workplace hints in the **title only** — e.g. `(Remote)`, `(Hybrid)`, `(On-site)`, or a trailing
 * `— Hybrid` / `- Remote` segment — before falling back to search HTTP params or full description.
 */
export function canonicalizeWorkplaceFromJobTitle(title: string | undefined | null): CanonicalWorkplaceType | null {
  const raw = String(title ?? "").trim();
  if (!raw) return null;

  for (const m of raw.matchAll(/\(([^)]+)\)/g)) {
    const inner = String(m[1] ?? "").trim();
    if (!inner) continue;
    const hit = classifyShortWorkplacePhrase(inner);
    if (hit) return hit;
  }

  const parts = raw.split(/\s*[—–\-]\s*/).map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 2) {
    const tail = parts[parts.length - 1]!;
    if (tail.length > 0 && tail.length <= 56 && tail !== raw) {
      const hit = classifyShortWorkplacePhrase(tail);
      if (hit) return hit;
    }
  }

  return null;
}

function firstParamValue(
  params: Record<string, string | number | boolean> | undefined,
  re: RegExp,
): string | undefined {
  if (!params) return undefined;
  for (const [k, v] of Object.entries(params)) {
    if (re.test(k)) return typeof v === "string" ? v : String(v);
  }
  return undefined;
}

/** Map Jobs API `workplaceTypes` tokens (and variants) to a single canonical value when possible. */
export function canonicalizeFromWorkplaceTypesParam(raw: string | undefined | null): CanonicalWorkplaceType | null {
  const s = String(raw ?? "")
    .trim()
    .toLowerCase();
  if (!s) return null;
  const parts = s
    .split(/[;,]/)
    .map((p) => p.trim().toLowerCase())
    .filter(Boolean);
  if (!parts.length) return null;
  const norm = (p: string) => p.replace(/[\s_-]+/g, "");
  const set = new Set(parts.map(norm));
  if (set.has("hybrid")) return "Hybrid";
  if (set.has("remote")) return "Remote";
  if (set.has("onsite") || set.has("on_site") || set.has("office")) return "Office";
  return null;
}

function workplaceFromIngestionParams(
  params: Record<string, string | number | boolean> | undefined,
): CanonicalWorkplaceType | null {
  if (!params) return null;
  const wp = firstParamValue(params, /(^|_)workplaceTypes$/i);
  if (wp) {
    const c = canonicalizeFromWorkplaceTypesParam(wp);
    if (c) return c;
    const alt = canonicalizeWorkplaceFromText(wp);
    if (alt) return alt;
  }
  const remote = firstParamValue(params, /(^|_)remote$/i);
  if (remote != null) {
    const v = String(remote).trim().toLowerCase();
    if (v === "true" || v === "1") return "Remote";
    if (v === "false" || v === "0") return "Office";
  }
  const wfh = firstParamValue(params, /(^|_)work_from_home$/i);
  if (wfh != null) {
    const v = String(wfh).trim().toLowerCase();
    if (v === "true" || v === "1") return "Remote";
  }
  return null;
}

function collectVendorWorkplaceStrings(job: NormalizedJob): string {
  const raw = job.raw;
  if (!raw || typeof raw !== "object") return "";
  const o = raw as Record<string, unknown>;
  const keys = [
    "workplaceType",
    "workplace_type",
    "workplaceTypes",
    "formattedWorkplaceType",
    "work_location_type",
    "locationType",
    "geoLocationType",
    "work_arrangement",
  ];
  const parts: string[] = [];
  const pushFrom = (obj: Record<string, unknown>) => {
    for (const k of keys) {
      const v = obj[k];
      if (typeof v === "string" && v.trim()) parts.push(v);
    }
  };
  pushFrom(o);
  const search = o.search;
  if (search && typeof search === "object") pushFrom(search as Record<string, unknown>);
  const detail = o.detail;
  if (detail && typeof detail === "object") pushFrom(detail as Record<string, unknown>);
  return parts.join(" | ");
}

/**
 * Derive Office | Remote | Hybrid for a normalized job:
 * 1) Vendor response fields (when present),
 * 2) **Title** parentheticals / short trailing workplace hints (e.g. `(Remote)`, `(On-site)`),
 * 3) **AI scoring** `workplaceTypeAi` from description (set after OpenAI scoring runs),
 * 4) HTTP search params used to fetch the row (`workplaceTypes`, `remote`, …),
 * 5) Phrase match on title + description + location,
 * 6) `isRemote`, else Office.
 */
export function resolveWorkplaceType(job: NormalizedJob): CanonicalWorkplaceType {
  const vendor = collectVendorWorkplaceStrings(job);
  const fromVendor = canonicalizeWorkplaceFromText(vendor);
  if (fromVendor) return fromVendor;

  const fromTitle = canonicalizeWorkplaceFromJobTitle(job.title);
  if (fromTitle) return fromTitle;

  const ai = job.workplaceTypeAi;
  if (ai === "Office" || ai === "Remote" || ai === "Hybrid") return ai;

  const fromParams = workplaceFromIngestionParams(job.ingestionRequestParams);
  if (fromParams) return fromParams;

  const textBlob = [vendor, job.title, job.description, job.location].filter(Boolean).join("\n");
  const fromText = canonicalizeWorkplaceFromText(textBlob);
  if (fromText) return fromText;

  if (job.isRemote === true) return "Remote";
  if (job.isRemote === false) return "Office";

  return "Office";
}

export function assignWorkplaceTypeToJob(job: NormalizedJob): NormalizedJob {
  return { ...job, workplaceType: resolveWorkplaceType(job) };
}
