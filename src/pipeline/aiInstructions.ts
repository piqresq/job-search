import {
  getStoredOpenAiDraftInstruction,
  getStoredOpenAiScoringInstruction,
  setStoredOpenAiDraftInstruction,
  setStoredOpenAiScoringInstruction,
} from "../db/appSettings";
import {
  COMPANY_SENTENCE_POSITION_SUMMARY_ADDENDUM,
  DEFAULT_OPENAI_DRAFT_INSTRUCTION,
  DEFAULT_OPENAI_SCORING_INSTRUCTION,
  POSITION_SUMMARY_SCORING_ADDENDUM,
  WORKPLACE_TYPE_SCORING_ADDENDUM,
} from "./aiInstructionDefaults";
import { GROSS_MONTHLY_MIN_EUR, NET_MONTHLY_MIN_EUR } from "./hardFilters";

/** Max stored length per instruction (UTF-16 code units); avoids oversized Worker requests. */
export const AI_INSTRUCTION_MAX_CHARS = 120_000;

export function applyScoringInstructionPlaceholders(raw: string): string {
  return raw
    .replaceAll("{{NET_MONTHLY_MIN_EUR}}", String(NET_MONTHLY_MIN_EUR))
    .replaceAll("{{GROSS_MONTHLY_MIN_EUR}}", String(GROSS_MONTHLY_MIN_EUR));
}

/** Upgrades legacy stored instructions so the model returns position_summary. Idempotent. */
async function ensurePositionSummaryKeyInScoringInstruction(db: D1Database): Promise<void> {
  const raw = await getStoredOpenAiScoringInstruction(db);
  if (!raw?.trim()) return;
  if (raw.includes("position_summary")) return;
  await setStoredOpenAiScoringInstruction(db, raw.trimEnd() + POSITION_SUMMARY_SCORING_ADDENDUM);
}

/** One-time append: employer-focused sentence in position_summary (3 sentences total). Idempotent. */
async function ensureCompanySentenceInPositionSummary(db: D1Database): Promise<void> {
  const raw = await getStoredOpenAiScoringInstruction(db);
  if (!raw?.trim()) return;
  if (!raw.includes("position_summary")) return;
  if (raw.includes("position_summary structure update")) return;
  if (raw.includes("Sentence 1 (employer)")) return;
  await setStoredOpenAiScoringInstruction(db, raw.trimEnd() + COMPANY_SENTENCE_POSITION_SUMMARY_ADDENDUM);
}

/** One-time append: model returns workplace_type for pipeline workplace column. Idempotent. */
async function ensureWorkplaceTypeKeyInScoringInstruction(db: D1Database): Promise<void> {
  const raw = await getStoredOpenAiScoringInstruction(db);
  if (!raw?.trim()) return;
  if (raw.includes("workplace_type")) return;
  await setStoredOpenAiScoringInstruction(db, raw.trimEnd() + WORKPLACE_TYPE_SCORING_ADDENDUM);
}

/**
 * Loads scoring system text from D1 (lazy-seeds defaults), substitutes salary floor placeholders.
 * Used as the main body of the scoring system message before "Candidate profile:".
 */
export async function loadScoringInstructionForPrompt(db: D1Database): Promise<string> {
  let raw = await getStoredOpenAiScoringInstruction(db);
  if (!raw?.trim()) {
    raw = DEFAULT_OPENAI_SCORING_INSTRUCTION;
    await setStoredOpenAiScoringInstruction(db, raw);
  } else {
    await ensurePositionSummaryKeyInScoringInstruction(db);
    raw = (await getStoredOpenAiScoringInstruction(db)) ?? raw;
    await ensureWorkplaceTypeKeyInScoringInstruction(db);
    raw = (await getStoredOpenAiScoringInstruction(db)) ?? raw;
  }
  return applyScoringInstructionPlaceholders(raw);
}

export async function loadDraftInstructionForPrompt(db: D1Database): Promise<string> {
  let raw = await getStoredOpenAiDraftInstruction(db);
  if (!raw?.trim()) {
    raw = DEFAULT_OPENAI_DRAFT_INSTRUCTION;
    await setStoredOpenAiDraftInstruction(db, raw);
  }
  return raw;
}

export function validateScoringInstructionForSave(s: string): string | null {
  if (s.length > AI_INSTRUCTION_MAX_CHARS) return "scoring_instruction_too_long";
  const t = s.trim();
  if (!t) return "scoring_instruction_empty";
  if (!t.includes("fit_score") || !t.includes("recommendation") || !t.includes("position_summary")) {
    return "scoring_instruction_missing_keys_hint";
  }
  return null;
}

export function validateDraftInstructionForSave(s: string): string | null {
  if (s.length > AI_INSTRUCTION_MAX_CHARS) return "draft_instruction_too_long";
  const t = s.trim();
  if (!t) return "draft_instruction_empty";
  if (!t.includes("cv_html") || !t.includes("cover_letter")) {
    return "draft_instruction_missing_keys_hint";
  }
  return null;
}

export async function resetOpenAiInstructionsToDefaults(db: D1Database): Promise<void> {
  await setStoredOpenAiScoringInstruction(db, DEFAULT_OPENAI_SCORING_INSTRUCTION);
  await setStoredOpenAiDraftInstruction(db, DEFAULT_OPENAI_DRAFT_INSTRUCTION);
}

async function ensureAiInstructionsSeeded(db: D1Database): Promise<void> {
  let s = await getStoredOpenAiScoringInstruction(db);
  if (!s?.trim()) {
    await setStoredOpenAiScoringInstruction(db, DEFAULT_OPENAI_SCORING_INSTRUCTION);
  }
  let d = await getStoredOpenAiDraftInstruction(db);
  if (!d?.trim()) {
    await setStoredOpenAiDraftInstruction(db, DEFAULT_OPENAI_DRAFT_INSTRUCTION);
  }
}

/** Raw stored text for dashboard (placeholders like {{NET_MONTHLY_MIN_EUR}} preserved). */
export async function getAiInstructionsForEditor(db: D1Database): Promise<{ scoring: string; drafts: string }> {
  await ensureAiInstructionsSeeded(db);
  await ensurePositionSummaryKeyInScoringInstruction(db);
  await ensureCompanySentenceInPositionSummary(db);
  const scoring = await getStoredOpenAiScoringInstruction(db);
  const drafts = await getStoredOpenAiDraftInstruction(db);
  return { scoring: scoring ?? "", drafts: drafts ?? "" };
}
