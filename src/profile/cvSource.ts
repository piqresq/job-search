import { getCvExtractionFromDb } from "../db/cvCache";
import { sanitizeCvTextForAiScoring } from "./cvSanitizeForScoring";
import { CV_SOURCE_TEXT } from "./cv-extracted.gen";
import { CV_SOURCE_HTML } from "./cv-extracted-html.gen";

/**
 * Single read: D1 cache is used only when **both** text and HTML rows are present and non-empty
 * (avoids mixing one DB field with bundled fallback for the other).
 */
export async function getCvSources(db: D1Database): Promise<{ text: string; html: string }> {
  const row = await getCvExtractionFromDb(db);
  if (row.text?.trim() && row.html?.trim()) {
    return { text: row.text, html: row.html };
  }
  return { text: CV_SOURCE_TEXT, html: CV_SOURCE_HTML };
}

export async function getCvSourceText(db: D1Database): Promise<string> {
  return (await getCvSources(db)).text;
}

export async function getCvSourceHtml(db: D1Database): Promise<string> {
  return (await getCvSources(db)).html;
}

/** For dashboard Settings: whether the Worker uses uploaded CV or bundled repository extract. */
export async function getCvCacheStatus(db: D1Database): Promise<{
  source: "database" | "bundled";
  uploadedAtUnix: number | null;
  textChars: number;
  htmlChars: number;
  /** Chars of D1-cached privacy extract for scoring (0 until next upload after this feature). */
  sanitizedTextChars: number;
  hasSanitizedTextCache: boolean;
}> {
  const row = await getCvExtractionFromDb(db);
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
    source: "bundled",
    uploadedAtUnix: null,
    textChars: CV_SOURCE_TEXT.length,
    htmlChars: CV_SOURCE_HTML.length,
    sanitizedTextChars: 0,
    hasSanitizedTextCache: false,
  };
}

/**
 * Plain text sent to OpenAI **scoring** only: uses D1 `cv_sanitized_text` when present (written on upload);
 * otherwise sanitizes raw extract in memory (legacy DB row or bundled fallback).
 */
export async function getCvTextForAiScoring(db: D1Database): Promise<string> {
  const row = await getCvExtractionFromDb(db);
  if (row.text?.trim() && row.html?.trim()) {
    if (row.sanitizedText?.trim()) return row.sanitizedText;
    return sanitizeCvTextForAiScoring(row.text);
  }
  return sanitizeCvTextForAiScoring(CV_SOURCE_TEXT);
}
