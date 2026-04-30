import { getAiInstructionsForEditor } from "../pipeline/aiInstructions";
import {
  setStoredOpenAiDraftInstruction,
  setStoredOpenAiScoringInstruction,
} from "./appSettings";

export const AI_INSTRUCTION_REVISION_MAX = 50;

export type AiInstructionRevisionSource = "save" | "reset" | "revert";

export type AiInstructionRevisionRow = {
  id: number;
  created_at: number;
  scoring: string;
  drafts: string;
  source: string;
  note: string;
};

export type AiInstructionRevisionListItem = {
  id: number;
  createdAt: number;
  source: AiInstructionRevisionSource | string;
  previewScoring: string;
  previewDrafts: string;
  note: string;
};

/** Max length for revision notes (UTF-16 code units). */
export const AI_INSTRUCTION_REVISION_NOTE_MAX = 2000;

function previewSnippet(s: string, max = 140): string {
  const oneLine = s.replace(/\s+/g, " ").trim();
  if (oneLine.length <= max) return oneLine;
  return oneLine.slice(0, max - 1) + "…";
}

async function trimExcessRevisions(db: D1Database): Promise<void> {
  const row = await db
    .prepare("SELECT COUNT(*) as c FROM ai_instruction_revisions")
    .first<{ c: number }>();
  const c = row?.c ?? 0;
  if (c <= AI_INSTRUCTION_REVISION_MAX) return;
  const excess = c - AI_INSTRUCTION_REVISION_MAX;
  await db
    .prepare(
      `DELETE FROM ai_instruction_revisions WHERE id IN (
        SELECT id FROM ai_instruction_revisions ORDER BY id ASC LIMIT ?
      )`,
    )
    .bind(excess)
    .run();
}

function normalizeRevisionNote(raw: string | undefined): string {
  const s = (raw ?? "").trim();
  if (s.length <= AI_INSTRUCTION_REVISION_NOTE_MAX) return s;
  return s.slice(0, AI_INSTRUCTION_REVISION_NOTE_MAX);
}

export function validateRevisionNoteForSave(raw: string): string | null {
  if (raw.length > AI_INSTRUCTION_REVISION_NOTE_MAX) {
    return "revision_note_too_long";
  }
  return null;
}

/** Record a snapshot after save, reset, or revert. Trims oldest rows beyond the cap. */
export async function appendAiInstructionRevision(
  db: D1Database,
  payload: {
    scoring: string;
    drafts: string;
    source: AiInstructionRevisionSource;
    note?: string;
  },
  nowSec: number,
): Promise<void> {
  const note = normalizeRevisionNote(payload.note);
  await db
    .prepare(
      `INSERT INTO ai_instruction_revisions (created_at, scoring, drafts, source, note)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .bind(nowSec, payload.scoring, payload.drafts, payload.source, note)
    .run();
  await trimExcessRevisions(db);
}

export async function listAiInstructionRevisions(
  db: D1Database,
  limit: number,
): Promise<AiInstructionRevisionListItem[]> {
  const cap = Math.min(Math.max(1, limit), 100);
  const res = await db
    .prepare(
      `SELECT id, created_at, scoring, drafts, source, note
       FROM ai_instruction_revisions
       ORDER BY id DESC
       LIMIT ?`,
    )
    .bind(cap)
    .all<AiInstructionRevisionRow>();
  const list = res.results ?? [];
  return list.map((r) => ({
    id: r.id,
    createdAt: r.created_at,
    source: r.source as AiInstructionRevisionSource,
    previewScoring: previewSnippet(r.scoring),
    previewDrafts: previewSnippet(r.drafts),
    note: r.note ?? "",
  }));
}

export async function getAiInstructionRevisionById(
  db: D1Database,
  id: number,
): Promise<AiInstructionRevisionRow | null> {
  if (!Number.isFinite(id) || id <= 0) return null;
  const row = await db
    .prepare(
      `SELECT id, created_at, scoring, drafts, source, note
       FROM ai_instruction_revisions WHERE id = ?`,
    )
    .bind(id)
    .first<AiInstructionRevisionRow>();
  return row ?? null;
}

export async function updateAiInstructionRevisionNote(
  db: D1Database,
  revisionId: number,
  note: string,
): Promise<boolean> {
  if (!Number.isFinite(revisionId) || revisionId <= 0) return false;
  const n = normalizeRevisionNote(note);
  const res = await db
    .prepare(`UPDATE ai_instruction_revisions SET note = ? WHERE id = ?`)
    .bind(n, revisionId)
    .run();
  return (res.meta.changes ?? 0) > 0;
}

export function normalizeInstructionNewlines(s: string): string {
  return s.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

export function aiInstructionSnapshotsEqual(
  a: { scoring: string; drafts: string },
  b: { scoring: string; drafts: string },
): boolean {
  return (
    normalizeInstructionNewlines(a.scoring) === normalizeInstructionNewlines(b.scoring) &&
    normalizeInstructionNewlines(a.drafts) === normalizeInstructionNewlines(b.drafts)
  );
}

export async function deleteAiInstructionRevision(db: D1Database, id: number): Promise<boolean> {
  if (!Number.isFinite(id) || id <= 0) return false;
  const res = await db
    .prepare(`DELETE FROM ai_instruction_revisions WHERE id = ?`)
    .bind(id)
    .run();
  return (res.meta.changes ?? 0) > 0;
}

/** Apply stored revision to app_settings; append the displaced (current) snapshot when it differs. */
export async function revertAiInstructionsToRevision(
  db: D1Database,
  revisionId: number,
  nowSec: number,
  revertNote?: string,
): Promise<{ scoring: string; drafts: string } | null> {
  const before = await getAiInstructionsForEditor(db);
  const rev = await getAiInstructionRevisionById(db, revisionId);
  if (!rev) return null;
  const target = { scoring: rev.scoring, drafts: rev.drafts };
  if (aiInstructionSnapshotsEqual(before, target)) {
    return { scoring: rev.scoring, drafts: rev.drafts };
  }
  await setStoredOpenAiScoringInstruction(db, rev.scoring);
  await setStoredOpenAiDraftInstruction(db, rev.drafts);
  await appendAiInstructionRevision(
    db,
    {
      scoring: before.scoring,
      drafts: before.drafts,
      source: "revert",
      note: revertNote,
    },
    nowSec,
  );
  await deleteAiInstructionRevision(db, revisionId);
  return { scoring: rev.scoring, drafts: rev.drafts };
}
