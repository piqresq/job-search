/**
 * Dashboard "Pipeline & extraction": only `ingestionRequestParams` — HTTP request facts
 * (what was sent to the provider), not API response fields.
 */

export type IngestionFact = { label: string; value: string };

const MAX_FACTS = 64;
/** Raw vendor `normalized_json.raw` can be wide; keep ingestion facts capped separately. */
const MAX_RAW_API_FACTS = 400;
const MAX_STRING_LEN = 520;

/** Display order for common request keys (any provider). */
const PREFERRED_KEYS: string[] = [
  "method",
  "host",
  "path",
  "title_filter",
  "location_filter",
  "description_type",
  "date_filter",
  "type_filter",
  "remote",
  "agency",
  "include_ai",
  "limit",
  "offset",
  "query",
  "page",
  "num_pages",
  "work_from_home",
  "date_posted",
  "country",
  "employment_types",
  "search_method",
  "search_host",
  "search_path",
  "search_query",
  "search_location",
  "search_datePosted",
  "search_workplaceTypes",
  "search_employmentTypes",
  "search_token",
  "detail_method",
  "detail_host",
  "detail_path",
  "detail_id",
];

const LABELS: Record<string, string> = {
  method: "HTTP method",
  host: "Host",
  path: "Path",
  title_filter: "Title filter",
  location_filter: "Location filter",
  description_type: "Description type",
  date_filter: "Date filter",
  type_filter: "Employment type filter",
  remote: "Remote filter",
  agency: "Agency",
  include_ai: "Include AI",
  limit: "Limit",
  offset: "Offset",
  query: "Query",
  page: "Page",
  num_pages: "Pages per request",
  work_from_home: "Work from home",
  date_posted: "Date posted filter",
  country: "Country",
  employment_types: "Employment types",
};

function truncate(s: string, max: number): string {
  const t = s.trim();
  if (t.length <= max) return t;
  return t.slice(0, max - 1) + "…";
}

function humanizeKey(key: string): string {
  const s = key
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .trim();
  if (!s.length) return key;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function labelForRequestKey(key: string): string {
  if (LABELS[key]) return LABELS[key];
  if (key.startsWith("search_")) {
    const rest = key.slice("search_".length);
    return rest ? `Search · ${LABELS[rest] ?? humanizeKey(rest)}` : humanizeKey(key);
  }
  if (key.startsWith("detail_")) {
    const rest = key.slice("detail_".length);
    return rest ? `Detail · ${LABELS[rest] ?? humanizeKey(rest)}` : humanizeKey(key);
  }
  return humanizeKey(key);
}

function stringifyValue(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number") return String(v);
  if (typeof v === "string") {
    const t = v.trim();
    return t.length ? truncate(t, MAX_STRING_LEN) : null;
  }
  return null;
}

/**
 * Builds label/value rows from persisted `jobs.normalized_json.ingestionRequestParams` only.
 */
export function buildIngestionFactsFromNormalizedJson(json: string | null | undefined): IngestionFact[] {
  if (!json?.trim()) return [];
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(json) as Record<string, unknown>;
  } catch {
    return [];
  }

  const req = obj.ingestionRequestParams;
  if (!req || typeof req !== "object" || Array.isArray(req)) {
    return [];
  }

  const params = req as Record<string, unknown>;
  const keys = Object.keys(params);
  if (keys.length === 0) return [];

  const preferredSet = new Set(PREFERRED_KEYS);
  const ordered: string[] = [];
  for (const k of PREFERRED_KEYS) {
    if (k in params) ordered.push(k);
  }
  const rest = keys.filter((k) => !preferredSet.has(k)).sort((a, b) => a.localeCompare(b));
  const keyOrder = [...ordered, ...rest];

  const out: IngestionFact[] = [];
  const seen = new Set<string>();

  for (const key of keyOrder) {
    if (out.length >= MAX_FACTS) break;
    const str = stringifyValue(params[key]);
    if (str == null) continue;
    const label = labelForRequestKey(key);
    const dedupe = label + "\0" + str;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);
    out.push({ label, value: str });
  }

  return out;
}

/** True when `normalized_json` contains a non-empty `ingestionRequestParams` object. */
export function hasStoredIngestionRequestParams(json: string | null | undefined): boolean {
  if (!json?.trim()) return false;
  try {
    const obj = JSON.parse(json) as Record<string, unknown>;
    const req = obj.ingestionRequestParams;
    if (!req || typeof req !== "object" || Array.isArray(req)) return false;
    return Object.keys(req as Record<string, unknown>).length > 0;
  } catch {
    return false;
  }
}

function stringifyRawFieldValue(v: unknown, path: string[]): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  if (typeof v === "string") {
    const t = v.trim();
    if (!t.length) return null;
    if (isFullTextRawDescriptionPath(path)) return v;
    return truncate(t, MAX_STRING_LEN);
  }
  try {
    return truncate(JSON.stringify(v), MAX_STRING_LEN);
  } catch {
    return null;
  }
}

/**
 * Leaf paths whose values are long prose (job listing body). Matches humanized key segments
 * (underscores → spaces, first char capitalized), e.g. LinkedIn `description_text` → "Description text".
 */
function isFullTextRawDescriptionPath(path: string[]): boolean {
  const lastRaw = path[path.length - 1] ?? "";
  const last = lastRaw.trim().toLowerCase().replace(/\s+/g, " ");
  if (!last || /^\[\d+\]$/.test(last)) return false;
  if (last === "has description" || last.includes("description type") || last.includes("description filter")) {
    return false;
  }
  if (/^description( text| html| snippet)?$/.test(last)) return true;
  if (/^job description( text| html| snippet)?$/.test(last)) return true;
  return false;
}

function stringifyRawStringForFlattenedPath(v: string, path: string[]): string | null {
  if (isFullTextRawDescriptionPath(path)) {
    return v;
  }
  const t = v.trim();
  return t.length ? truncate(t, MAX_STRING_LEN) : null;
}

const MAX_RAW_FLATTEN_DEPTH = 12;

function formatRawFieldPath(segments: string[]): string {
  if (segments.length === 0) return "(root)";
  return segments.join(" · ");
}

function rawObjectKeyPriority(key: string): number {
  const l = key.toLowerCase();
  if (l.includes("description")) return 0;
  return 1;
}

function sortRawObjectKeys(keys: string[]): string[] {
  return [...keys].sort((a, b) => {
    const pa = rawObjectKeyPriority(a);
    const pb = rawObjectKeyPriority(b);
    if (pa !== pb) return pa - pb;
    return a.localeCompare(b);
  });
}

function pushRawFact(out: IngestionFact[], seen: Set<string>, label: string, value: string, maxRows: number): void {
  if (out.length >= maxRows) return;
  const dedupe = label + "\0" + value;
  if (seen.has(dedupe)) return;
  seen.add(dedupe);
  out.push({ label, value });
}

/**
 * Recursively flattens `normalized_json.raw` into label/value rows (e.g. Jobs API `Detail` / `Search` objects).
 */
function appendFlattenedRawFields(
  value: unknown,
  path: string[],
  out: IngestionFact[],
  seen: Set<string>,
  depth: number,
  maxRows: number,
): void {
  if (out.length >= maxRows) return;

  if (depth > MAX_RAW_FLATTEN_DEPTH) {
    const s = stringifyRawFieldValue(value, path);
    if (s) pushRawFact(out, seen, formatRawFieldPath(path), s, maxRows);
    return;
  }

  if (value === null) {
    pushRawFact(out, seen, formatRawFieldPath(path), "(null)", maxRows);
    return;
  }
  if (value === undefined) {
    pushRawFact(out, seen, formatRawFieldPath(path), "(undefined)", maxRows);
    return;
  }

  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    let s: string | null;
    if (typeof value === "string") {
      s = stringifyRawStringForFlattenedPath(value, path);
    } else {
      s = stringifyRawFieldValue(value, path);
    }
    if (s !== null) pushRawFact(out, seen, formatRawFieldPath(path), s, maxRows);
    return;
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      pushRawFact(out, seen, formatRawFieldPath(path), "(empty array)", maxRows);
      return;
    }
    for (let i = 0; i < value.length; i++) {
      if (out.length >= maxRows) return;
      appendFlattenedRawFields(value[i], [...path, `[${i}]`], out, seen, depth + 1, maxRows);
    }
    return;
  }

  if (typeof value === "object") {
    const o = value as Record<string, unknown>;
    const keys = sortRawObjectKeys(Object.keys(o));
    if (keys.length === 0) {
      pushRawFact(out, seen, formatRawFieldPath(path), "(empty object)", maxRows);
      return;
    }
    for (const k of keys) {
      if (out.length >= maxRows) return;
      const seg = humanizeKey(k);
      appendFlattenedRawFields(o[k], [...path, seg], out, seen, depth + 1, maxRows);
    }
  }
}

/**
 * Label/value rows from `normalized_json.raw` — vendor API response fragment (nested objects flattened).
 */
export function buildRawApiFieldsFromNormalizedJson(json: string | null | undefined): IngestionFact[] {
  if (!json?.trim()) return [];
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(json) as Record<string, unknown>;
  } catch {
    return [];
  }
  const raw = obj.raw;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
  const rec = raw as Record<string, unknown>;
  const keys = sortRawObjectKeys(Object.keys(rec));
  const out: IngestionFact[] = [];
  const seen = new Set<string>();
  for (const key of keys) {
    if (out.length >= MAX_RAW_API_FACTS) break;
    const seg = humanizeKey(key);
    appendFlattenedRawFields(rec[key], [seg], out, seen, 0, MAX_RAW_API_FACTS);
  }
  return out;
}

/** True when normalized job JSON has a non-empty `raw` object. */
export function hasStoredApiRawFields(json: string | null | undefined): boolean {
  if (!json?.trim()) return false;
  try {
    const obj = JSON.parse(json) as Record<string, unknown>;
    const raw = obj.raw;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
    return Object.keys(raw as Record<string, unknown>).length > 0;
  } catch {
    return false;
  }
}
