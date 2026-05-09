import {
  getStoredOpenAiDraftInstruction,
  getStoredOpenAiScoringPolicyInstruction,
  getStoredOpenAiScoringInstruction,
  setStoredOpenAiDraftInstruction,
  setStoredOpenAiScoringPolicyInstruction,
  setStoredOpenAiScoringInstruction,
} from "../db/appSettings";
import { getGlobalScoringContract } from "../db/globalSettings";
import {
  COMPANY_SENTENCE_POSITION_SUMMARY_ADDENDUM,
  DEFAULT_OPENAI_SCORING_POLICY_INSTRUCTION,
  DEFAULT_OPENAI_DRAFT_INSTRUCTION,
  DEFAULT_OPENAI_SCORING_INSTRUCTION,
  OPENAI_SCORING_CONTRACT_INSTRUCTION,
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

/**
 * Build the scoring system prompt from the scoring contract (global) and per-user policy.
 * In a future step, contract will be read from global_settings D1 row; for now it's hardcoded.
 */
export function composeScoringInstructionForPrompt(
  policy: string,
  contractOverride?: string,
): string {
  const contract = contractOverride?.trim() || OPENAI_SCORING_CONTRACT_INSTRUCTION;
  return applyScoringInstructionPlaceholders(
    [contract, policy.trim()].filter(Boolean).join("\n\n"),
  );
}

async function getOrSeedScoringPolicyInstruction(db: D1Database, userId: string): Promise<string> {
  let raw = await getStoredOpenAiScoringPolicyInstruction(db, userId);
  if (!raw?.trim()) {
    raw = DEFAULT_OPENAI_SCORING_POLICY_INSTRUCTION;
    await setStoredOpenAiScoringPolicyInstruction(db, userId, raw);
  }
  return raw;
}

async function ensurePositionSummaryKeyInScoringInstruction(
  db: D1Database,
  userId: string,
): Promise<void> {
  const raw = await getStoredOpenAiScoringInstruction(db, userId);
  if (!raw?.trim()) return;
  if (raw.includes("position_summary")) return;
  await setStoredOpenAiScoringInstruction(db, userId, raw.trimEnd() + POSITION_SUMMARY_SCORING_ADDENDUM);
}

async function ensureCompanySentenceInPositionSummary(
  db: D1Database,
  userId: string,
): Promise<void> {
  const raw = await getStoredOpenAiScoringInstruction(db, userId);
  if (!raw?.trim()) return;
  if (!raw.includes("position_summary")) return;
  if (raw.includes("position_summary structure update")) return;
  if (raw.includes("Sentence 1 (employer)")) return;
  await setStoredOpenAiScoringInstruction(
    db,
    userId,
    raw.trimEnd() + COMPANY_SENTENCE_POSITION_SUMMARY_ADDENDUM,
  );
}

async function ensureWorkplaceTypeKeyInScoringInstruction(
  db: D1Database,
  userId: string,
): Promise<void> {
  const raw = await getStoredOpenAiScoringInstruction(db, userId);
  if (!raw?.trim()) return;
  if (raw.includes("workplace_type")) return;
  await setStoredOpenAiScoringInstruction(
    db,
    userId,
    raw.trimEnd() + WORKPLACE_TYPE_SCORING_ADDENDUM,
  );
}

/**
 * Loads scoring system text from D1 (lazy-seeds defaults), substitutes salary floor placeholders.
 * The contract (global rules) is read from global_settings first; falls back to the in-code constant.
 */
export async function loadScoringInstructionForPrompt(
  db: D1Database,
  userId: string,
): Promise<string> {
  const [policy, contractFromDb] = await Promise.all([
    getOrSeedScoringPolicyInstruction(db, userId),
    getGlobalScoringContract(db).catch(() => null),
  ]);
  return composeScoringInstructionForPrompt(policy, contractFromDb ?? undefined);
}

export async function loadDraftInstructionForPrompt(
  db: D1Database,
  userId: string,
): Promise<string> {
  let raw = await getStoredOpenAiDraftInstruction(db, userId);
  if (!raw?.trim()) {
    raw = DEFAULT_OPENAI_DRAFT_INSTRUCTION;
    await setStoredOpenAiDraftInstruction(db, userId, raw);
  }
  return raw;
}

export function validateScoringInstructionForSave(s: string): string | null {
  if (s.length > AI_INSTRUCTION_MAX_CHARS) return "scoring_instruction_too_long";
  const t = s.trim();
  if (!t) return "scoring_instruction_empty";
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

export async function resetOpenAiInstructionsToDefaults(
  db: D1Database,
  userId: string,
): Promise<void> {
  await setStoredOpenAiScoringInstruction(db, userId, DEFAULT_OPENAI_SCORING_INSTRUCTION);
  await setStoredOpenAiScoringPolicyInstruction(db, userId, DEFAULT_OPENAI_SCORING_POLICY_INSTRUCTION);
  await setStoredOpenAiDraftInstruction(db, userId, DEFAULT_OPENAI_DRAFT_INSTRUCTION);
}

async function ensureAiInstructionsSeeded(db: D1Database, userId: string): Promise<void> {
  const s = await getStoredOpenAiScoringInstruction(db, userId);
  if (!s?.trim()) {
    await setStoredOpenAiScoringInstruction(db, userId, DEFAULT_OPENAI_SCORING_INSTRUCTION);
  }
  const p = await getStoredOpenAiScoringPolicyInstruction(db, userId);
  if (!p?.trim()) {
    await setStoredOpenAiScoringPolicyInstruction(db, userId, DEFAULT_OPENAI_SCORING_POLICY_INSTRUCTION);
  }
  const d = await getStoredOpenAiDraftInstruction(db, userId);
  if (!d?.trim()) {
    await setStoredOpenAiDraftInstruction(db, userId, DEFAULT_OPENAI_DRAFT_INSTRUCTION);
  }
}

/** Raw stored editable policy for dashboard; backend scoring contract is not exposed. */
export async function getAiInstructionsForEditor(
  db: D1Database,
  userId: string,
): Promise<{ scoring: string; drafts: string }> {
  await ensureAiInstructionsSeeded(db, userId);
  await ensurePositionSummaryKeyInScoringInstruction(db, userId);
  await ensureCompanySentenceInPositionSummary(db, userId);
  await ensureWorkplaceTypeKeyInScoringInstruction(db, userId);
  const scoring = await getOrSeedScoringPolicyInstruction(db, userId);
  const drafts = await getStoredOpenAiDraftInstruction(db, userId);
  return { scoring: scoring ?? "", drafts: drafts ?? "" };
}
