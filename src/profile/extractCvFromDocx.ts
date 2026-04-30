/** Max characters per field stored in D1 (safety). */
const MAX_CV_FIELD_CHARS = 1_800_000;

/**
 * Extract plain text and HTML from a .docx using mammoth (same as `scripts/extract-cv.mjs`).
 */
export async function extractCvFromDocxArrayBuffer(arrayBuffer: ArrayBuffer): Promise<{
  text: string;
  html: string;
}> {
  const mammoth = await import("mammoth");

  const [rawText, htmlResult] = await Promise.all([
    mammoth.extractRawText({ arrayBuffer }),
    mammoth.convertToHtml({ arrayBuffer }),
  ]);

  const text = String(rawText?.value ?? "").trim();
  const html = String(htmlResult?.value ?? "").trim();

  if (text.length > MAX_CV_FIELD_CHARS || html.length > MAX_CV_FIELD_CHARS) {
    throw new Error("cv_extract_too_large");
  }

  return { text, html };
}
