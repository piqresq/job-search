import { getCvExtractionFromDb } from "../db/cvCache";
import { sanitizeCvTextForAiScoring } from "./cvSanitizeForScoring";

const EMPTY_CV = { text: "", html: "" } as const;

/**
 * Single read: D1 cache is used only when **both** text and HTML rows are present and non-empty.
 */
export async function getCvSources(db: D1Database, userId: string): Promise<{ text: string; html: string }> {
  const row = await getCvExtractionFromDb(db, userId);
  if (row.text?.trim() && row.html?.trim()) {
    return { text: row.text, html: row.html };
  }
  return { ...EMPTY_CV };
}

export async function getCvSourceText(db: D1Database, userId: string): Promise<string> {
  return (await getCvSources(db, userId)).text;
}

export async function getCvSourceHtml(db: D1Database, userId: string): Promise<string> {
  return (await getCvSources(db, userId)).html;
}

/** For dashboard Settings: whether the Worker uses an uploaded CV from D1. */
export async function getCvCacheStatus(db: D1Database, userId: string): Promise<{
  source: "database" | "none";
  uploadedAtUnix: number | null;
  textChars: number;
  htmlChars: number;
  /** Chars of D1-cached privacy extract for scoring (0 until next upload after this feature). */
  sanitizedTextChars: number;
  hasSanitizedTextCache: boolean;
}> {
  const row = await getCvExtractionFromDb(db, userId);
  if (row.text?.trim() && row.html?.trim()) {
    const st = row.sanitizedText ?? "";
    return {
      source: "database",
      uploadedAtUnix: row.uploadedAtUnix,
      textChars: row.text.length,
      htmlChars: row.html.length,
      sanitizedTextChars: st.length,
      hasSanitizedTextCache: st.length > 0,
    };
  }
  return {
    source: "none",
    uploadedAtUnix: null,
    textChars: 0,
    htmlChars: 0,
    sanitizedTextChars: 0,
    hasSanitizedTextCache: false,
  };
}

/**
 * Plain text sent to OpenAI **scoring** only: uses D1 `cv_sanitized_text` when present (written on upload);
 * otherwise sanitizes raw extract in memory (legacy DB row).
 */
export async function getCvTextForAiScoring(db: D1Database, userId: string): Promise<string> {
  const row = await getCvExtractionFromDb(db, userId);
  if (row.text?.trim() && row.html?.trim()) {
    if (row.sanitizedText?.trim()) return row.sanitizedText;
    return sanitizeCvTextForAiScoring(row.text);
  }
  return "";
}
