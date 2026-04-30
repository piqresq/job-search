import { sanitizeCvTextForAiScoring } from "../profile/cvSanitizeForScoring";

const CV_SOURCE_TEXT_KEY = "cv_source_text";
const CV_SOURCE_HTML_KEY = "cv_source_html";
const CV_UPLOADED_AT_UNIX_KEY = "cv_uploaded_at_unix";
/** Plain text passed to OpenAI scoring only; built at upload next to full extract. */
const CV_SANITIZED_TEXT_KEY = "cv_sanitized_text";

async function getSetting(db: D1Database, key: string): Promise<string | null> {
  const row = await db
    .prepare("SELECT value FROM app_settings WHERE key = ?")
    .bind(key)
    .first<{ value: string }>();
  return row?.value ?? null;
}

export type CvExtractionRow = {
  text: string | null;
  html: string | null;
  uploadedAtUnix: number | null;
  /** Privacy-safe text for AI scoring; set on each successful upload. */
  sanitizedText: string | null;
};

export async function getCvExtractionFromDb(db: D1Database): Promise<CvExtractionRow> {
  const [text, html, at, sanitized] = await Promise.all([
    getSetting(db, CV_SOURCE_TEXT_KEY),
    getSetting(db, CV_SOURCE_HTML_KEY),
    getSetting(db, CV_UPLOADED_AT_UNIX_KEY),
    getSetting(db, CV_SANITIZED_TEXT_KEY),
  ]);
  const uploadedAtUnix =
    at != null && String(at).trim() !== "" ? parseInt(String(at).trim(), 10) : null;
  const u =
    uploadedAtUnix != null && Number.isFinite(uploadedAtUnix) && uploadedAtUnix > 0
      ? uploadedAtUnix
      : null;
  return { text, html, uploadedAtUnix: u, sanitizedText: sanitized?.trim() ? sanitized : null };
}

export async function setCvExtractionCache(
  db: D1Database,
  opts: { text: string; html: string; uploadedAtUnix: number; sanitizedText?: string },
): Promise<void> {
  const sanitizedText = opts.sanitizedText ?? sanitizeCvTextForAiScoring(opts.text);
  await db.batch([
    db
      .prepare(
        `INSERT INTO app_settings (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      )
      .bind(CV_SOURCE_TEXT_KEY, opts.text),
    db
      .prepare(
        `INSERT INTO app_settings (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      )
      .bind(CV_SOURCE_HTML_KEY, opts.html),
    db
      .prepare(
        `INSERT INTO app_settings (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      )
      .bind(CV_UPLOADED_AT_UNIX_KEY, String(opts.uploadedAtUnix)),
    db
      .prepare(
        `INSERT INTO app_settings (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      )
      .bind(CV_SANITIZED_TEXT_KEY, sanitizedText),
  ]);
}
