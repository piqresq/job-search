import type { SearchRoleTiers } from "../config/searchRoles";
import { normalizeSearchRoleList, normalizeSearchRoleTiers } from "../config/searchRoles";
import { getSearchRoleTiers, setSearchRoleTiers } from "./appSettings";
import { AI_INSTRUCTION_REVISION_NOTE_MAX } from "./aiInstructionRevisions";

export const SEARCH_ROLE_REVISION_MAX = 50;

export type SearchRoleRevisionSource = "save" | "reset" | "revert";

export type SearchRoleRevisionRow = {
  id: number;
  created_at: number;
  tier1_json: string;
  tier2_json: string;
  source: string;
  note: string;
};

export type SearchRoleRevisionListItem = {
  id: number;
  createdAt: number;
  source: SearchRoleRevisionSource | string;
  previewTier1: string;
  previewTier2: string;
  note: string;
};

function previewSnippet(s: string, max = 140): string {
  const oneLine = s.replace(/\s+/g, " ").trim();
  if (oneLine.length <= max) return oneLine;
  return oneLine.slice(0, max - 1) + "…";
}

function normalizeRevisionNote(raw: string | undefined): string {
  const s = (raw ?? "").trim();
  if (s.length <= AI_INSTRUCTION_REVISION_NOTE_MAX) return s;
  return s.slice(0, AI_INSTRUCTION_REVISION_NOTE_MAX);
}

function parseTierJson(s: string): string[] {
  try {
    const p = JSON.parse(s) as unknown;
    if (!Array.isArray(p)) return [];
    return normalizeSearchRoleList(p);
  } catch {
    return [];
  }
}

/** Parse stored JSON tier columns into normalized tier lists. */
export function tiersFromRevisionRow(row: SearchRoleRevisionRow): SearchRoleTiers {
  return normalizeSearchRoleTiers(
    {
      tier1: parseTierJson(row.tier1_json),
      tier2: parseTierJson(row.tier2_json),
    },
    { fallbackToDefaults: false },
  );
}

async function trimExcessRevisions(db: D1Database): Promise<void> {
  const row = await db
    .prepare("SELECT COUNT(*) as c FROM search_role_revisions")
    .first<{ c: number }>();
  const c = row?.c ?? 0;
  if (c <= SEARCH_ROLE_REVISION_MAX) return;
  const excess = c - SEARCH_ROLE_REVISION_MAX;
  await db
    .prepare(
      `DELETE FROM search_role_revisions WHERE id IN (
        SELECT id FROM search_role_revisions ORDER BY id ASC LIMIT ?
      )`,
    )
    .bind(excess)
    .run();
}

export async function appendSearchRoleRevision(
  db: D1Database,
  payload: {
    tiers: SearchRoleTiers;
    source: SearchRoleRevisionSource;
    note?: string;
  },
  nowSec: number,
): Promise<void> {
  const normalized = normalizeSearchRoleTiers(payload.tiers, { fallbackToDefaults: false });
  const note = normalizeRevisionNote(payload.note);
  await db
    .prepare(
      `INSERT INTO search_role_revisions (created_at, tier1_json, tier2_json, source, note)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .bind(
      nowSec,
      JSON.stringify(normalized.tier1),
      JSON.stringify(normalized.tier2),
      payload.source,
      note,
    )
    .run();
  await trimExcessRevisions(db);
}

export async function listSearchRoleRevisions(
  db: D1Database,
  limit: number,
): Promise<SearchRoleRevisionListItem[]> {
  const cap = Math.min(Math.max(1, limit), 100);
  const res = await db
    .prepare(
      `SELECT id, created_at, tier1_json, tier2_json, source, note
       FROM search_role_revisions
       ORDER BY id DESC
       LIMIT ?`,
    )
    .bind(cap)
    .all<SearchRoleRevisionRow>();
  const list = res.results ?? [];
  return list.map((r) => {
    const t = tiersFromRevisionRow(r);
    const p1 = previewSnippet(t.tier1.join(", "));
    const p2 = previewSnippet(t.tier2.join(", "));
    return {
      id: r.id,
      createdAt: r.created_at,
      source: r.source as SearchRoleRevisionSource,
      previewTier1: p1,
      previewTier2: p2,
      note: r.note ?? "",
    };
  });
}

export async function getSearchRoleRevisionById(
  db: D1Database,
  id: number,
): Promise<SearchRoleRevisionRow | null> {
  if (!Number.isFinite(id) || id <= 0) return null;
  const row = await db
    .prepare(
      `SELECT id, created_at, tier1_json, tier2_json, source, note
       FROM search_role_revisions WHERE id = ?`,
    )
    .bind(id)
    .first<SearchRoleRevisionRow>();
  return row ?? null;
}

export async function updateSearchRoleRevisionNote(
  db: D1Database,
  revisionId: number,
  note: string,
): Promise<boolean> {
  if (!Number.isFinite(revisionId) || revisionId <= 0) return false;
  const n = normalizeRevisionNote(note);
  const res = await db
    .prepare(`UPDATE search_role_revisions SET note = ? WHERE id = ?`)
    .bind(n, revisionId)
    .run();
  return (res.meta.changes ?? 0) > 0;
}

export async function deleteSearchRoleRevision(db: D1Database, id: number): Promise<boolean> {
  if (!Number.isFinite(id) || id <= 0) return false;
  const res = await db
    .prepare(`DELETE FROM search_role_revisions WHERE id = ?`)
    .bind(id)
    .run();
  return (res.meta.changes ?? 0) > 0;
}

export function searchRoleTiersEqual(a: SearchRoleTiers, b: SearchRoleTiers): boolean {
  const na = normalizeSearchRoleTiers(a, { fallbackToDefaults: false });
  const nb = normalizeSearchRoleTiers(b, { fallbackToDefaults: false });
  if (na.tier1.length !== nb.tier1.length || na.tier2.length !== nb.tier2.length) return false;
  for (let i = 0; i < na.tier1.length; i++) if (na.tier1[i] !== nb.tier1[i]) return false;
  for (let i = 0; i < na.tier2.length; i++) if (na.tier2[i] !== nb.tier2[i]) return false;
  return true;
}

export async function revertSearchRolesToRevision(
  db: D1Database,
  revisionId: number,
  nowSec: number,
  revertNote?: string,
): Promise<SearchRoleTiers | null> {
  const before = await getSearchRoleTiers(db);
  const rev = await getSearchRoleRevisionById(db, revisionId);
  if (!rev) return null;
  const tiers = tiersFromRevisionRow(rev);
  if (searchRoleTiersEqual(before, tiers)) {
    return tiers;
  }
  await setSearchRoleTiers(db, tiers);
  await appendSearchRoleRevision(
    db,
    { tiers: before, source: "revert", note: revertNote },
    nowSec,
  );
  await deleteSearchRoleRevision(db, revisionId);
  return tiers;
}
